from django.contrib import admin

from .models import Answer, GameSession, Player


class PlayerInline(admin.TabularInline):
    model = Player
    extra = 0
    readonly_fields = ("joined_at",)


@admin.register(GameSession)
class GameSessionAdmin(admin.ModelAdmin):
    list_display = ("code", "quiz", "host", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("code", "host__username", "quiz__title")
    inlines = [PlayerInline]


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("nickname", "session", "user", "score", "is_connected")
    list_filter = ("is_connected",)
    search_fields = ("nickname", "session__code")


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ("player", "question", "choice", "is_correct", "points_awarded", "answered_at")
    list_filter = ("is_correct",)
