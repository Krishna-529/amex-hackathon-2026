package concierge.rebook

# Gate for every proposed re-booking action.
# Nothing is booked unless this package says allow == true.

default allow := false

allow if {
	input.action.type == "rebook_flight"
	input.action.offer_id != "" # grounding: no supplier offer, no booking
	input.action.offer_ttl_s > 30
	input.action.cabin in data.policy.trip.cabins
	not input.action.carrier in data.policy.trip.blocked_carriers
	fare_delta_ok
}

fare_delta_ok if {
	input.action.fare_delta_inr <= data.policy.trip.max_fare_delta_inr
}

# ---------------------------------------------------------------------------
# Denial reasons — surfaced in the decision ledger so the dashboard can explain
# *why* an option was rejected, not merely that it was.
# ---------------------------------------------------------------------------

deny contains "not_a_rebook_action" if {
	input.action.type != "rebook_flight"
}

deny contains "missing_supplier_offer" if {
	input.action.offer_id == ""
}

deny contains "offer_expired" if {
	input.action.offer_ttl_s <= 30
}

deny contains "cabin_not_permitted" if {
	not input.action.cabin in data.policy.trip.cabins
}

deny contains "carrier_blocked" if {
	input.action.carrier in data.policy.trip.blocked_carriers
}

deny contains "fare_delta_exceeds_cap" if {
	not fare_delta_ok
}
