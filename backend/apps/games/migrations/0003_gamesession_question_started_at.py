from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("games", "0002_lobby_lock_and_kick")]

    operations = [
        migrations.AddField(
            model_name="gamesession",
            name="question_started_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the current question opened. NULL = no question is accepting answers.",
                null=True,
            ),
        ),
    ]
