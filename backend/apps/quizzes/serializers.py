"""Nested Quiz -> Question -> Choice serializers.

Write rules (all enforced here, so the viewset stays thin):
  * every question needs >= 2 choices and exactly one correct choice
  * a quiz can only be published when it has at least one question
  * `order` is never sent by the client: it is the question's position in the `questions` list
  * updates diff by id (see QuizSerializer.update) so unchanged rows keep their primary keys,
    which keeps Answer rows from past games alive when a host edits a quiz

Note: this is the *host-facing* serializer and exposes `is_correct`. The player-facing question
payload (Phase 4) must be a separate serializer that omits it.
"""
from django.db import transaction
from rest_framework import serializers

from .models import Choice, Question, Quiz, Tag

MAX_TAGS = 10


class ChoiceSerializer(serializers.ModelSerializer):
    # Optional on write: present = "update this existing choice", absent = "new choice".
    id = serializers.IntegerField(required=False)

    class Meta:
        model = Choice
        fields = ["id", "text", "is_correct"]


class QuestionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)
    choices = ChoiceSerializer(many=True)

    class Meta:
        model = Question
        fields = ["id", "text", "time_limit_s", "points", "order", "choices"]
        read_only_fields = ["order"]  # derived from list position

    def validate_choices(self, choices: list[dict]) -> list[dict]:
        if len(choices) < 2:
            raise serializers.ValidationError("Add at least two choices.")
        correct = sum(1 for choice in choices if choice.get("is_correct"))
        if correct != 1:
            raise serializers.ValidationError("Mark exactly one choice as correct.")
        return choices


class TagNamesField(serializers.ListField):
    """Tags as a plain list of names: normalised on input, created on the fly on save."""

    child = serializers.CharField(max_length=40)

    def get_attribute(self, instance: Quiz) -> list[str]:
        # .all() hits the prefetch cache, so this costs no extra query per quiz.
        return sorted(tag.name for tag in instance.tags.all())

    def to_internal_value(self, data) -> list[str]:
        names = super().to_internal_value(data)
        cleaned = list(dict.fromkeys(name.strip().lower() for name in names))  # dedupe, keep order
        if len(cleaned) > MAX_TAGS:
            raise serializers.ValidationError(f"Use at most {MAX_TAGS} tags.")
        return cleaned


class QuizSerializer(serializers.ModelSerializer):
    """Full quiz including questions and choices (detail, create, update)."""

    tags = TagNamesField(required=False)
    questions = QuestionSerializer(many=True)

    class Meta:
        model = Quiz
        fields = [
            "id",
            "title",
            "description",
            "is_published",
            "tags",
            "questions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    # ---- validation -------------------------------------------------------------------------

    def validate(self, attrs: dict) -> dict:
        questions = attrs.get("questions", [])
        if attrs.get("is_published") and not questions:
            raise serializers.ValidationError(
                {"questions": ["Add at least one question before publishing."]}
            )
        self._validate_ids(questions)
        return attrs

    def _validate_ids(self, questions: list[dict]) -> None:
        """Ids in the payload must belong to *this* quiz (none are allowed on create)."""
        known: dict[int, set[int]] = {}
        if self.instance is not None:
            for question in self.instance.questions.all():
                known[question.id] = {choice.id for choice in question.choices.all()}

        question_errors: list[dict] = []
        seen_questions: set[int] = set()
        for question in questions:
            errors: dict = {}
            question_id = question.get("id")
            if question_id is not None:
                if question_id not in known or question_id in seen_questions:
                    errors["id"] = ["Unknown or duplicate question."]
                seen_questions.add(question_id)

            seen_choices: set[int] = set()
            choice_errors: list[dict] = []
            for choice in question["choices"]:
                choice_id = choice.get("id")
                bad = choice_id is not None and (
                    question_id not in known
                    or choice_id not in known[question_id]
                    or choice_id in seen_choices
                )
                choice_errors.append({"id": ["Unknown or duplicate choice."]} if bad else {})
                if choice_id is not None:
                    seen_choices.add(choice_id)
            if any(choice_errors):
                errors["choices"] = choice_errors
            question_errors.append(errors)

        if any(question_errors):
            raise serializers.ValidationError({"questions": question_errors})

    # ---- writes -----------------------------------------------------------------------------

    @transaction.atomic
    def create(self, validated_data: dict) -> Quiz:
        questions = validated_data.pop("questions", [])
        tags = validated_data.pop("tags", [])
        quiz = Quiz.objects.create(**validated_data)
        self._set_tags(quiz, tags)
        self._sync_questions(quiz, questions)
        return quiz

    @transaction.atomic
    def update(self, instance: Quiz, validated_data: dict) -> Quiz:
        questions = validated_data.pop("questions", None)
        tags = validated_data.pop("tags", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if tags is not None:
            self._set_tags(instance, tags)
        if questions is not None:
            self._sync_questions(instance, questions)
        return instance

    @staticmethod
    def _set_tags(quiz: Quiz, names: list[str]) -> None:
        quiz.tags.set([Tag.objects.get_or_create(name=name)[0] for name in names])

    @staticmethod
    def _sync_questions(quiz: Quiz, payload: list[dict]) -> None:
        """Make the quiz's questions/choices match `payload`, diffing by id.

        Rows with a known id are updated in place, rows without one are created, and rows that
        are no longer in the payload are deleted. Position in the list becomes `order`.
        """
        existing_questions = {q.id: q for q in Question.objects.filter(quiz=quiz)}
        kept_ids = {item["id"] for item in payload if item.get("id") is not None}
        Question.objects.filter(quiz=quiz).exclude(id__in=kept_ids).delete()  # cascades choices

        to_update, to_create = [], []
        for order, item in enumerate(payload):
            fields = {k: item[k] for k in ("text", "time_limit_s", "points") if k in item}
            if item.get("id") is None:
                to_create.append(Question(quiz=quiz, order=order, **fields))
            else:
                question = existing_questions[item["id"]]
                for attr, value in fields.items():
                    setattr(question, attr, value)
                question.order = order
                to_update.append(question)
        if to_update:
            Question.objects.bulk_update(to_update, ["text", "time_limit_s", "points", "order"])
        Question.objects.bulk_create(to_create)  # Postgres fills in the new primary keys

        # Pair each payload item with its saved Question (created ones come back in order).
        created = iter(to_create)
        saved = [
            existing_questions[item["id"]] if item.get("id") is not None else next(created)
            for item in payload
        ]

        existing_choices = {
            c.id: c for c in Choice.objects.filter(question__in=[q.pk for q in saved])
        }
        kept_choice_ids = {
            c["id"] for item in payload for c in item["choices"] if c.get("id") is not None
        }
        Choice.objects.filter(question__quiz=quiz).exclude(id__in=kept_choice_ids).delete()

        choices_update, choices_create = [], []
        for question, item in zip(saved, payload, strict=True):
            for data in item["choices"]:
                if data.get("id") is None:
                    choices_create.append(
                        Choice(question=question, text=data["text"], is_correct=data["is_correct"])
                    )
                else:
                    choice = existing_choices[data["id"]]
                    choice.text = data["text"]
                    choice.is_correct = data["is_correct"]
                    choices_update.append(choice)
        if choices_update:
            Choice.objects.bulk_update(choices_update, ["text", "is_correct"])
        Choice.objects.bulk_create(choices_create)


class QuizListSerializer(serializers.ModelSerializer):
    """Light version for the library: no nested questions, just a count."""

    tags = TagNamesField(read_only=True)
    question_count = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        fields = [
            "id",
            "title",
            "description",
            "is_published",
            "tags",
            "question_count",
            "created_at",
            "updated_at",
        ]

    def get_question_count(self, obj: Quiz) -> int:
        return len(obj.questions.all())  # prefetched in the viewset: no per-row COUNT query
