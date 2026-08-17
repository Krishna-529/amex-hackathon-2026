package zkd.execute

import rego.v1

# The default-deny gate for every EXECUTE-plane side effect
# (documentation/design/03-action-policy.md §5, architecture diagram Part 03).
# Reaching the end with no rule objecting is the ONLY way to get an allow —
# this file is the source of truth for that statement, not a comment next to
# some TypeScript that might drift from it.
#
# `input` is zkd-shared's PolicyInput shape (zkd-shared/src/types.ts) — kept
# in sync deliberately, see execute_test.rego for the contract asserted from
# the Rego side and zkd-shared/src/opaClient.ts for the HTTP shape.

default allow := false

allow if {
	count(deny) == 0
}

# Rego's comparisons are UNDEFINED, not false, when a referenced field is
# missing — so `input.cabinRank > input.cabinEntitlementRank` simply fails to
# match on malformed input instead of denying, and every rule below being
# silently skipped would leave `deny` empty and `allow` true. Caught by
# execute_test.rego's empty-input case. Treat missing required fields as a
# denial in their own right, so "we don't have enough to evaluate this" can
# never resolve to an allow.
required_fields := {
	"consent", "originalFlightOperated", "offerId", "rejectedOfferIds",
	"cabinRank", "cabinEntitlementRank", "fareDelta", "fareDeltaCap",
	"departureAtMs", "travelWindowStartMs", "travelWindowEndMs",
	"seatsAvailable", "partySize",
}

deny contains "malformed_input" if {
	missing := required_fields - object.keys(input)
	count(missing) > 0
}

# Involuntary vs voluntary is derived from whether the ORIGINAL flight
# operated — never from whether the member was inconvenienced. Getting this
# backwards silently bills the carrier for a change it doesn't owe.
deny contains "voluntary_under_autopilot" if {
	input.originalFlightOperated == true
	input.consent == "autopilot"
}

deny contains "member_rejected_offer" if {
	input.offerId in input.rejectedOfferIds
}

deny contains "fare_class_ceiling" if {
	input.cabinRank > input.cabinEntitlementRank
}

deny contains "fare_delta_cap" if {
	input.fareDelta > input.fareDeltaCap
}

deny contains "travel_window" if {
	input.departureAtMs < input.travelWindowStartMs
}

deny contains "travel_window" if {
	input.departureAtMs > input.travelWindowEndMs
}

deny contains "seat_exists" if {
	input.seatsAvailable < input.partySize
}
