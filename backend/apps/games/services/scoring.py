"""Atomic score updates under high concurrency.

TODO:
  @transaction.atomic
  def submit_answer(player_id, question_id, choice_id) -> Answer:
      - lock row: Player.objects.select_for_update().get(pk=player_id)
      - reject duplicate answers (unique constraint + IntegrityError handling)
      - compute points from correctness + time remaining
      - update score with F("score") + points (never read-modify-write in Python)
"""
