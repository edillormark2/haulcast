from django.urls import path

from planner.api import views

urlpatterns = [
    path("health/", views.HealthView.as_view(), name="health"),
    path("rules/", views.RiskRulesView.as_view(), name="rules"),
    path("geocode/", views.GeocodeView.as_view(), name="geocode"),
    path("plans/", views.PlanView.as_view(), name="plans"),
    path("heatmap/", views.HeatmapView.as_view(), name="heatmap"),
]
