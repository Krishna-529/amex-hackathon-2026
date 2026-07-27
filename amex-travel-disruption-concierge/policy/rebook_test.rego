package concierge.rebook_test

import data.concierge.rebook

# The offer the concierge actually books in the demo: 6E2114 MAA->DEL.
good_action := {"action": {
	"type": "rebook_flight",
	"offer_id": "O-9F2K",
	"offer_ttl_s": 240,
	"cabin": "ECONOMY",
	"carrier": "6E",
	"fare_delta_inr": 8450,
}}

test_allows_grounded_in_policy_offer if {
	rebook.allow with input as good_action
}

test_denies_when_no_supplier_offer if {
	not rebook.allow with input as json.patch(good_action, [{"op": "replace", "path": "/action/offer_id", "value": ""}])
}

test_denies_expired_offer if {
	a := json.patch(good_action, [{"op": "replace", "path": "/action/offer_ttl_s", "value": 12}])
	not rebook.allow with input as a
	"offer_expired" in rebook.deny with input as a
}

test_denies_offer_ttl_exactly_30 if {
	not rebook.allow with input as json.patch(good_action, [{"op": "replace", "path": "/action/offer_ttl_s", "value": 30}])
}

test_denies_blocked_carrier if {
	a := json.patch(good_action, [{"op": "replace", "path": "/action/carrier", "value": "G8"}])
	not rebook.allow with input as a
	"carrier_blocked" in rebook.deny with input as a
}

test_denies_cabin_outside_trip_policy if {
	a := json.patch(good_action, [{"op": "replace", "path": "/action/cabin", "value": "FIRST"}])
	not rebook.allow with input as a
	"cabin_not_permitted" in rebook.deny with input as a
}

test_denies_fare_delta_over_cap if {
	a := json.patch(good_action, [{"op": "replace", "path": "/action/fare_delta_inr", "value": 62400}])
	not rebook.allow with input as a
	"fare_delta_exceeds_cap" in rebook.deny with input as a
}

test_allows_fare_delta_exactly_at_cap if {
	rebook.allow with input as json.patch(good_action, [{"op": "replace", "path": "/action/fare_delta_inr", "value": 45000}])
}

test_denies_non_rebook_action if {
	a := json.patch(good_action, [{"op": "replace", "path": "/action/type", "value": "book_hotel"}])
	not rebook.allow with input as a
	"not_a_rebook_action" in rebook.deny with input as a
}

test_default_deny_on_empty_input if {
	not rebook.allow with input as {}
}
