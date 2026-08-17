package zkd.execute_test

import data.zkd.execute
import rego.v1

base_input := {
	"consent": "ask",
	"originalFlightOperated": false,
	"offerId": "alt-1",
	"rejectedOfferIds": [],
	"cabinRank": 0,
	"cabinEntitlementRank": 0,
	"fareDelta": 0,
	"fareDeltaCap": 25000,
	"departureAtMs": 1000,
	"travelWindowStartMs": 0,
	"travelWindowEndMs": 100000,
	"seatsAvailable": 4,
	"partySize": 1,
}

test_allows_a_clean_candidate if {
	execute.allow with input as base_input
}

test_default_deny_on_empty_input if {
	not execute.allow with input as {}
	execute.deny["malformed_input"] with input as {}
}

test_default_deny_on_partial_input_missing_seat_fields if {
	partial := object.remove(base_input, ["seatsAvailable", "partySize"])
	not execute.allow with input as partial
	execute.deny["malformed_input"] with input as partial
}

test_denies_voluntary_change_under_autopilot if {
	tc := object.union(base_input, {"originalFlightOperated": true, "consent": "autopilot"})
	not execute.allow with input as tc
	execute.deny["voluntary_under_autopilot"] with input as tc
}

test_allows_voluntary_change_under_ask if {
	# Voluntary is fine when the member is explicitly asking — only autopilot
	# denies it outright, because autopilot is standing permission for what
	# the carrier owes, not a blank check for what the member chooses.
	tc := object.union(base_input, {"originalFlightOperated": true, "consent": "ask"})
	execute.allow with input as tc
}

test_denies_rejected_offer if {
	tc := object.union(base_input, {"offerId": "alt-9", "rejectedOfferIds": ["alt-9"]})
	not execute.allow with input as tc
	execute.deny["member_rejected_offer"] with input as tc
}

test_denies_cabin_over_entitlement if {
	tc := object.union(base_input, {"cabinRank": 2, "cabinEntitlementRank": 0})
	not execute.allow with input as tc
	execute.deny["fare_class_ceiling"] with input as tc
}

test_allows_cabin_at_exactly_entitlement if {
	tc := object.union(base_input, {"cabinRank": 1, "cabinEntitlementRank": 1})
	execute.allow with input as tc
}

test_denies_fare_delta_over_cap if {
	tc := object.union(base_input, {"fareDelta": 30000, "fareDeltaCap": 25000})
	not execute.allow with input as tc
	execute.deny["fare_delta_cap"] with input as tc
}

test_allows_fare_delta_at_exactly_the_cap if {
	tc := object.union(base_input, {"fareDelta": 25000, "fareDeltaCap": 25000})
	execute.allow with input as tc
}

test_denies_departure_before_travel_window if {
	tc := object.union(base_input, {"departureAtMs": -1, "travelWindowStartMs": 0})
	not execute.allow with input as tc
	execute.deny["travel_window"] with input as tc
}

test_denies_departure_after_travel_window if {
	tc := object.union(base_input, {"departureAtMs": 100001, "travelWindowEndMs": 100000})
	not execute.allow with input as tc
	execute.deny["travel_window"] with input as tc
}

test_denies_when_no_seat_for_the_whole_party if {
	tc := object.union(base_input, {"seatsAvailable": 2, "partySize": 3})
	not execute.allow with input as tc
	execute.deny["seat_exists"] with input as tc
}

test_allows_when_seats_exactly_match_party_size if {
	tc := object.union(base_input, {"seatsAvailable": 3, "partySize": 3})
	execute.allow with input as tc
}

test_multiple_denials_all_reported_any_deny_is_terminal if {
	tc := object.union(base_input, {"fareDelta": 99999, "fareDeltaCap": 25000, "seatsAvailable": 0, "partySize": 1})
	not execute.allow with input as tc
	execute.deny["fare_delta_cap"] with input as tc
	execute.deny["seat_exists"] with input as tc
	count(execute.deny) == 2 with input as tc
}
