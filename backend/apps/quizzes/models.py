"""Quiz content (authored by hosts). Planned models:

Quiz      : owner FK->User, title, description, is_published, created_at
Question  : quiz FK->Quiz (related_name="questions"), text, time_limit_s, points, order
Choice    : question FK->Question (related_name="choices"), text, is_correct
            (enforce exactly one correct choice per question in clean()/serializer)

Use select_related/prefetch_related("questions__choices") in the viewset queryset.
"""
