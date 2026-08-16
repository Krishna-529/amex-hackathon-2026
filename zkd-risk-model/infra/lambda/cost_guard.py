"""Degrade gracefully when the monthly budget is breached.

Triggered by the SNS topic AWS Budgets publishes to at 100% ACTUAL spend
(see ../budgets.tf). Widens the batch-scorer cadence and turns off the
event-driven rescorer rather than paging someone at 3am to do it by hand —
the system falls back to warm-candidates-only with less lead time, which is
the same degraded-but-safe posture the model already takes when hold
conversion falls below its floor.
"""
import json
import os

import boto3

scheduler = boto3.client("scheduler")
events = boto3.client("events")


def handler(event, _context):
    schedule_arn = os.environ["SCHEDULE_ARN"]
    schedule_name = schedule_arn.split("/")[-1]
    group_name = schedule_arn.split("/")[-2]
    degraded_minutes = os.environ.get("DEGRADED_INTERVAL_MIN", "30")

    current = scheduler.get_schedule(Name=schedule_name, GroupName=group_name)
    scheduler.update_schedule(
        Name=schedule_name,
        GroupName=group_name,
        FlexibleTimeWindow=current["FlexibleTimeWindow"],
        ScheduleExpression=f"rate({degraded_minutes} minutes)",
        Target=current["Target"],
    )

    events.disable_rule(
        Name=os.environ["EVENT_RULE_NAME"],
        EventBusName=os.environ["EVENT_BUS_NAME"],
    )

    print(
        json.dumps(
            {
                "action": "cost_guard_triggered",
                "batch_interval_minutes": degraded_minutes,
                "event_scorer": "disabled",
            }
        )
    )
    return {"statusCode": 200}
