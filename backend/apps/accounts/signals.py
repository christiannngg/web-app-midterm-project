from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import PlayerProfile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile(sender, instance, created, **kwargs):
    """Every user gets exactly one PlayerProfile."""
    if created:
        PlayerProfile.objects.get_or_create(user=instance)
