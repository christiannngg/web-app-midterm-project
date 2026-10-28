from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import PlayerProfile, User


class PlayerProfileInline(admin.StackedInline):
    model = PlayerProfile
    can_delete = False


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "email", "role", "is_staff", "is_active")
    list_filter = ("role", "is_staff", "is_active")
    fieldsets = UserAdmin.fieldsets + (("Trivia", {"fields": ("role",)}),)
    add_fieldsets = UserAdmin.add_fieldsets + (("Trivia", {"fields": ("role",)}),)
    inlines = [PlayerProfileInline]


@admin.register(PlayerProfile)
class PlayerProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "games_played", "games_won", "total_score")
    search_fields = ("user__username",)
