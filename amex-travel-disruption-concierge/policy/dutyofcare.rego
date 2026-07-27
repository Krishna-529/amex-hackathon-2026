package concierge.dutyofcare

# DGCA CAR Section 3, Series M, Part IV — Facilities to passengers on
# denied boarding, cancellation and delay of flights (India).
# Amounts are INR. This package is the ONLY source of duty-of-care truth.

owed contains "meals" if {
	input.delay_hours >= 2
}

owed contains "hotel_and_transfer" if {
	input.delay_hours >= 6
	input.overnight_window
}

owed contains "alt_flight_or_refund" if {
	input.delay_hours >= 6
}

# force majeure removes the cash slab but never the duty of care
cash_due if {
	not input.force_majeure
}

# ---------------------------------------------------------------------------
# Cancellation compensation slab, keyed on the block time of the cancelled
# sector: <= 1h -> 5,000 | 1-2h -> 7,500 | > 2h -> 10,000
# ... or the booked fare, whichever is LESS.
# ---------------------------------------------------------------------------

slab_inr := 5000 if {
	input.block_time_hours <= 1
}

slab_inr := 7500 if {
	input.block_time_hours > 1
	input.block_time_hours <= 2
}

slab_inr := 10000 if {
	input.block_time_hours > 2
}

# Payable cash compensation: min(slab, booked fare), and zero under force majeure.
compensation_inr := amount if {
	cash_due
	amount := min([slab_inr, input.booked_fare_inr])
}

compensation_inr := 0 if {
	not cash_due
}

# Convenience roll-up consumed by the concierge when assembling the claim packet.
packet := {
	"regulation": "DGCA CAR Section 3, Series M, Part IV",
	"owed": owed,
	"cash_due": cash_due,
	"slab_inr": slab_inr,
	"compensation_inr": compensation_inr,
	"delay_hours": input.delay_hours,
	"currency": "INR",
}
