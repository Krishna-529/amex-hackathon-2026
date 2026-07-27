package concierge.dutyofcare_test

import data.concierge.dutyofcare

# Priya's actual disruption: MAA->DEL cancelled 06:12, re-accommodated onto a
# flight arriving 7h10m late, into an overnight window before DEL->LHR.
priya := {
	"delay_hours": 7.17,
	"overnight_window": true,
	"force_majeure": false,
	"block_time_hours": 2.67,
	"booked_fare_inr": 18400,
}

test_meals_owed_at_two_hours if {
	"meals" in dutyofcare.owed with input as json.patch(priya, [{"op": "replace", "path": "/delay_hours", "value": 2}])
}

test_no_meals_under_two_hours if {
	not "meals" in dutyofcare.owed with input as json.patch(priya, [{"op": "replace", "path": "/delay_hours", "value": 1.9}])
}

test_hotel_and_transfer_owed_overnight_over_six_hours if {
	"hotel_and_transfer" in dutyofcare.owed with input as priya
}

test_no_hotel_when_not_overnight if {
	not "hotel_and_transfer" in dutyofcare.owed with input as json.patch(priya, [{"op": "replace", "path": "/overnight_window", "value": false}])
}

test_alt_flight_or_refund_owed_over_six_hours if {
	"alt_flight_or_refund" in dutyofcare.owed with input as priya
}

test_priya_is_owed_all_three if {
	dutyofcare.owed == {"meals", "hotel_and_transfer", "alt_flight_or_refund"} with input as priya
}

test_cash_due_when_not_force_majeure if {
	dutyofcare.cash_due with input as priya
}

test_no_cash_under_force_majeure if {
	not dutyofcare.cash_due with input as json.patch(priya, [{"op": "replace", "path": "/force_majeure", "value": true}])
}

# force majeure strips the cash slab but the duty of care survives
test_duty_of_care_survives_force_majeure if {
	i := json.patch(priya, [{"op": "replace", "path": "/force_majeure", "value": true}])
	dutyofcare.owed == {"meals", "hotel_and_transfer", "alt_flight_or_refund"} with input as i
	dutyofcare.compensation_inr == 0 with input as i
}

# --- cancellation slab ------------------------------------------------------

test_slab_5000_under_one_hour_block_time if {
	dutyofcare.slab_inr == 5000 with input as json.patch(priya, [{"op": "replace", "path": "/block_time_hours", "value": 0.75}])
}

test_slab_7500_between_one_and_two_hours if {
	dutyofcare.slab_inr == 7500 with input as json.patch(priya, [{"op": "replace", "path": "/block_time_hours", "value": 1.5}])
}

test_slab_10000_over_two_hours if {
	dutyofcare.slab_inr == 10000 with input as priya
}

test_compensation_is_slab_when_fare_is_higher if {
	dutyofcare.compensation_inr == 10000 with input as priya
}

test_compensation_capped_at_booked_fare if {
	i := json.patch(priya, [{"op": "replace", "path": "/booked_fare_inr", "value": 4200}])
	dutyofcare.compensation_inr == 4200 with input as i
}

test_packet_is_inr_and_dgca if {
	p := dutyofcare.packet with input as priya
	p.currency == "INR"
	p.regulation == "DGCA CAR Section 3, Series M, Part IV"
	p.compensation_inr == 10000
}
