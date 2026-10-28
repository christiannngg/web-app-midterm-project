"""Quiz content (authored by hosts).

Tag      : name (unique)                          -- Quiz <-> Tag is the Many-to-Many
Quiz     : owner FK->User, title, description, is_published, tags M2M
Question : quiz FK->Quiz (related_name="questions"), text, time_limit_s, points, order
Choice   : question FK->Question (related_name="choices"), text, is_correct

"Exactly one correct choice" and ">= 2 choices" are validated in the serializer (Phase 2);
use prefetch_related("questions__choices", "tags") in the viewset queryset.
"""
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Tag(models.Model):
    name = models.CharField(max_length=40, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Quiz(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quizzes"
    )
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)
    tags = models.ManyToManyField(Tag, blank=True, related_name="quizzes")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "quizzes"

    def __str__(self) -> str:
        return self.title


class Question(models.Model):
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="questions")
    text = models.CharField(max_length=300)
    time_limit_s = models.PositiveSmallIntegerField(
        default=20, validators=[MinValueValidator(5), MaxValueValidator(120)]
    )
    points = models.PositiveIntegerField(default=1000)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return f"{self.quiz_id}#{self.order}: {self.text[:40]}"


class Choice(models.Model):
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="choices")
    text = models.CharField(max_length=200)
    is_correct = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.text
