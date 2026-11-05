from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("games", "0003_gamesession_question_started_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesession",
            name="question_closed_at",
            field=models.DateTimeField(
                blank=True,
                help_text=(
                    "When the current question closed (its results are showing). "
                    "NULL while a question is open or before the first one."
                ),
                null=True,
            ),
        ),
    ]
