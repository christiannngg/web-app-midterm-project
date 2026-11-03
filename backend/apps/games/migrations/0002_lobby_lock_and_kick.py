from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("games", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamesession",
            name="is_locked",
            field=models.BooleanField(
                default=False, help_text="Host closed the lobby: no new players can join."
            ),
        ),
        migrations.AddField(
            model_name="player",
            name="is_kicked",
            field=models.BooleanField(
                default=False, help_text="Banned by the host. Kept as a row so they cannot rejoin."
            ),
        ),
        # Players now start disconnected and flip to connected when their socket joins.
        migrations.AlterField(
            model_name="player",
            name="is_connected",
            field=models.BooleanField(default=False),
        ),
    ]
