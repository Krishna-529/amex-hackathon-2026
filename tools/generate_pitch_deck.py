import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # Color Palette: Amex Blue / Dark Slate / Clean White / Accent Gold
    C_BLUE = RGBColor(0, 111, 207)     # #006FCF Amex Blue
    C_DARK = RGBColor(15, 23, 42)      # #0F172A Slate Dark
    C_WHITE = RGBColor(255, 255, 255)
    C_GRAY = RGBColor(100, 116, 139)   # #64748B Slate Gray
    C_LIGHT = RGBColor(248, 250, 252)  # #F8FAFC Light BG
    C_ACCENT = RGBColor(217, 119, 6)   # Amber accent

    blank_layout = prs.slide_layouts[6]

    def add_header(slide, title_text, category_text="ZKD CONCIERGE · AMERICAN EXPRESS / CODESTREET 2026"):
        # Category tracker
        cat_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.7), Inches(0.4))
        tf_cat = cat_box.text_frame
        tf_cat.word_wrap = True
        p_cat = tf_cat.paragraphs[0]
        p_cat.text = category_text.upper()
        p_cat.font.size = Pt(10)
        p_cat.font.bold = True
        p_cat.font.color.rgb = C_BLUE

        # Title
        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.8), Inches(11.7), Inches(0.8))
        tf = title_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title_text
        p.font.size = Pt(26)
        p.font.bold = True
        p.font.color.rgb = C_DARK

    # ==================== SLIDE 1: Title Slide ====================
    slide1 = prs.slides.add_slide(blank_layout)
    bg1 = slide1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
    bg1.fill.solid()
    bg1.fill.fore_color.rgb = C_DARK
    bg1.line.fill.background()

    tb1 = slide1.shapes.add_textbox(Inches(1.0), Inches(2.2), Inches(11.333), Inches(3.5))
    tf1 = tb1.text_frame
    tf1.word_wrap = True

    p0 = tf1.paragraphs[0]
    p0.text = "CODESTREET 2026 / AMERICAN EXPRESS"
    p0.font.size = Pt(14)
    p0.font.bold = True
    p0.font.color.rgb = C_BLUE
    p0.space_after = Pt(12)

    p1 = tf1.add_paragraph()
    p1.text = "ZKD Concierge"
    p1.font.size = Pt(48)
    p1.font.bold = True
    p1.font.color.rgb = C_WHITE
    p1.space_after = Pt(8)

    p2 = tf1.add_paragraph()
    p2.text = "Autonomous Travel-Disruption Concierge for Indian Domestic Aviation"
    p2.font.size = Pt(20)
    p2.font.color.rgb = RGBColor(203, 213, 225)
    p2.space_after = Pt(24)

    p3 = tf1.add_paragraph()
    p3.text = "Team ZKD · IIT Madras  |  Live MVP Presentation (20 min Pitch + 10 min Q&A)"
    p3.font.size = Pt(13)
    p3.font.color.rgb = C_GRAY

    # ==================== SLIDE 2: The Passenger Reality ====================
    slide2 = prs.slides.add_slide(blank_layout)
    add_header(slide2, "The Passenger Reality: From Panic to Peace of Mind")

    # Box 1: The Old Way
    box_old = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    box_old.fill.solid()
    box_old.fill.fore_color.rgb = RGBColor(254, 242, 242)
    box_old.line.color.rgb = RGBColor(254, 202, 202)
    tf_old = box_old.text_frame
    tf_old.word_wrap = True
    p = tf_old.paragraphs[0]
    p.text = "TODAY: The Reactive IRROPS Nightmare"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = RGBColor(185, 28, 28)
    p.space_after = Pt(14)

    bullets_old = [
        "Discovering cancellation only at the gate or via delayed SMS.",
        "45+ minute hold times with airline customer care centres.",
        "Scrambling for overpriced alternate flights & airport hotels.",
        "Opaque DGCA duty-of-care claims requiring manual paperwork."
    ]
    for b in bullets_old:
        p = tf_old.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(13)
        p.font.color.rgb = RGBColor(127, 29, 29)
        p.space_after = Pt(8)

    # Box 2: The ZKD Concierge Way
    box_new = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    box_new.fill.solid()
    box_new.fill.fore_color.rgb = RGBColor(240, 253, 244)
    box_new.line.color.rgb = RGBColor(187, 247, 208)
    tf_new = box_new.text_frame
    tf_new.word_wrap = True
    p = tf_new.paragraphs[0]
    p.text = "ZKD CONCIERGE: Proactive & Autonomous"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = RGBColor(21, 128, 61)
    p.space_after = Pt(14)

    bullets_new = [
        "Predictive warning 42s before formal airline cancellation.",
        "Instant push notification with pre-cached flight + hotel + ground options.",
        "1-tap pre-authorisation or autopilot protection without phone queues.",
        "Automatic compensation claims & zero out-of-pocket stress."
    ]
    for b in bullets_new:
        p = tf_new.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(13)
        p.font.color.rgb = RGBColor(20, 83, 45)
        p.space_after = Pt(8)

    # ==================== SLIDE 3: Live MVP Demo Flow ====================
    slide3 = prs.slides.add_slide(blank_layout)
    add_header(slide3, "Live MVP Demo Walkthrough (Pre-Tea Break Hero Flow)")

    steps = [
        ("1. Operator Console (/ops)", "Trigger test disruptions locally or hosted; tests webhook and poller simulation channels instantly."),
        ("2. Risk & LLM Explanation", "Live risk gauge crossing thresholds with plain-language Gemini LLM explanation of weather/airline risk."),
        ("3. Edge Case: Self-Cancel", "Demonstrates member-initiated changes, clean hand-off (`handed-over`), and zero-friction state sync."),
        ("4. 11-Sec Autonomous Recovery", "Pre-auth consent gate, multi-supplier option ranking, and 1-tap booking confirmation in ~11s.")
    ]

    for i, (stitle, sdesc) in enumerate(steps):
        col = i % 2
        row = i // 2
        left = Inches(0.8 + col * 6.0)
        top = Inches(1.8 + row * 2.5)

        card = slide3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, Inches(5.7), Inches(2.2))
        card.fill.solid()
        card.fill.fore_color.rgb = C_LIGHT
        card.line.color.rgb = RGBColor(226, 232, 240)
        tf = card.text_frame
        tf.word_wrap = True

        p = tf.paragraphs[0]
        p.text = stitle
        p.font.size = Pt(15)
        p.font.bold = True
        p.font.color.rgb = C_BLUE
        p.space_after = Pt(6)

        p2 = tf.add_paragraph()
        p2.text = sdesc
        p2.font.size = Pt(13)
        p2.font.color.rgb = C_GRAY

    # ==================== SLIDE 4: Predictive Disruption & Spotify/YouTube Analogy ====================
    slide4 = prs.slides.add_slide(blank_layout)
    add_header(slide4, "Predictive ML Model & Personalization (The Spotify Analogy)")

    box_ml1 = slide4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    box_ml1.fill.solid()
    box_ml1.fill.fore_color.rgb = C_LIGHT
    box_ml1.line.color.rgb = RGBColor(226, 232, 240)
    tf1 = box_ml1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "Self-Trained Cancellation Risk Model"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(10)

    for b in [
        "Built in `zkd-risk-model/`: XGBoost trained on real US DOT/BTS & Brazil ANAC historical data.",
        "Extracts weather, route congestion, and airline rolling delays.",
        "Outputs continuous probability score with adaptive thresholds (not flat 25/55/80).",
        "Advisory role: decides when we start preparing, never whether we spend member money."
    ]:
        p = tf1.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    box_ml2 = slide4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    box_ml2.fill.solid()
    box_ml2.fill.fore_color.rgb = C_LIGHT
    box_ml2.line.color.rgb = RGBColor(226, 232, 240)
    tf2 = box_ml2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "Personalization: The Spotify / YouTube Analogy"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_BLUE
    p.space_after = Pt(10)

    for b in [
        "Just like Spotify curates your discover weekly from listening history, ZKD learns cardmember preferences.",
        "Captures seat preference, cabin entitlement, layover tolerance, and companion rules.",
        "Translates free-text member intent (`zkd-app/server/preferences/intent.ts`) into weighted scoring rules.",
        "Dynamic adaptation: refines options based on implicit choices and explicit feedback."
    ]:
        p = tf2.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    # ==================== SLIDE 5: The Lifecycle Workflow ====================
    slide5 = prs.slides.add_slide(blank_layout)
    add_header(slide5, "The Disruption Lifecycle Workflow (Prediction Buys Speed)")

    phases = [
        ("1. PREDICT", "42s Head Start", "Model forecasts cancellation probability before airline files it. Pre-caches alt flights & hotels warm."),
        ("2. PRE-CACHE", "Zero Spend / No Hold", "Options priced and held warm in memory. No booking, no spend, no financial liability."),
        ("3. CONSENT GATE", "Member Control", "High-risk threshold triggers pre-auth. Member chooses or approves autopilot in advance."),
        ("4. ACT & SETTLE", "~11s Recovery", "Confirmed booking executed instantly. DGCA duty-of-care claims filed automatically.")
    ]

    for i, (ptitle, psub, pdesc) in enumerate(phases):
        left = Inches(0.8 + i * 2.9)
        card = slide5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, Inches(2.0), Inches(2.7), Inches(4.2))
        card.fill.solid()
        card.fill.fore_color.rgb = C_LIGHT
        card.line.color.rgb = RGBColor(203, 213, 225)
        tf = card.text_frame
        tf.word_wrap = True

        p = tf.paragraphs[0]
        p.text = ptitle
        p.font.size = Pt(15)
        p.font.bold = True
        p.font.color.rgb = C_BLUE
        p.space_after = Pt(4)

        p_sub = tf.add_paragraph()
        p_sub.text = psub
        p_sub.font.size = Pt(11)
        p_sub.font.bold = True
        p_sub.font.color.rgb = C_ACCENT
        p_sub.space_after = Pt(12)

        p_desc = tf.add_paragraph()
        p_desc.text = pdesc
        p_desc.font.size = Pt(12)
        p_desc.font.color.rgb = C_GRAY

    # ==================== SLIDE 6: System Architecture & Multi-Device Sync ====================
    slide6 = prs.slides.add_slide(blank_layout)
    add_header(slide6, "System Architecture & Multi-Device State Sync")

    box_arch1 = slide6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    box_arch1.fill.solid()
    box_arch1.fill.fore_color.rgb = C_LIGHT
    box_arch1.line.color.rgb = RGBColor(226, 232, 240)
    tf1 = box_arch1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "Server-Authoritative Simulation Engine"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(10)

    for b in [
        "Module-level simulation engine (`server/engine/simulation.ts`) runs the whole lifecycle.",
        "Real `setTimeout`/`setInterval` chains resolve on schedule whether devices watch or not.",
        "Single source of truth: shared state ledger (`server/decisionLedger.ts`).",
        "Zero GPU on critical path: 95% of time is network wait on supplier APIs."
    ]:
        p = tf1.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    box_arch2 = slide6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    box_arch2.fill.solid()
    box_arch2.fill.fore_color.rgb = C_LIGHT
    box_arch2.line.color.rgb = RGBColor(226, 232, 240)
    tf2 = box_arch2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "Multi-Device Sync & Identity Switchers"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_BLUE
    p.space_after = Pt(10)

    for b in [
        "Stateless clients: Next.js web app (`zkd-app/`) & Expo React Native Android app (`zkd-android/`).",
        "Clean polling architecture (`GET /api/passengers/[id]/schedule`).",
        "Identity switcher (`?as=p-priya` vs `?as=p-arjun`): open two tabs side-by-side to prove independent tenant state.",
        "Actions on mobile/web instantly converge via shared backend."
    ]:
        p = tf2.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    # ==================== SLIDE 7: Honest Experience KPIs Matrix ====================
    slide7 = prs.slides.add_slide(blank_layout)
    add_header(slide7, "Customer Experience KPIs Matrix (Strictly No Revenue Proxies)")

    # Add Table
    rows, cols = 5, 4
    left = Inches(0.8)
    top = Inches(1.8)
    width = Inches(11.7)
    height = Inches(4.8)

    table_shape = slide7.shapes.add_table(rows, cols, left, top, width, height)
    table = table_shape.table
    table.columns[0].width = Inches(2.2)
    table.columns[1].width = Inches(3.2)
    table.columns[2].width = Inches(2.0)
    table.columns[3].width = Inches(4.3)

    headers = ["Category", "Metric Name", "Status", "System Evidence / Reality"]
    for j, h in enumerate(headers):
        cell = table.cell(0, j)
        cell.text = h
        cell.fill.solid()
        cell.fill.fore_color.rgb = C_DARK
        p = cell.text_frame.paragraphs[0]
        p.font.bold = True
        p.font.size = Pt(12)
        p.font.color.rgb = C_WHITE

    kpi_data = [
        ("Speed", "Time to Plan Ready (A2)", "EXISTS", "~11s measured via pipeline journal (`journal.ts`)."),
        ("Member Effort", "Hand-off Rate (B2)", "EXISTS", "Tracked via `DisruptionResolution.kind === 'handed-over'`."),
        ("Outcome Quality", "Plan Acceptance Rate (C1)", "EXISTS", "Resolved as approved/autopilot over total recoveries."),
        ("Trust & Loyalty", "Autopilot Opt-in (E2)", "EXISTS", "Share of members trusting system unsupervised.")
    ]

    for i, row_vals in enumerate(kpi_data):
        for j, val in enumerate(row_vals):
            cell = table.cell(i + 1, j)
            cell.text = val
            cell.fill.solid()
            cell.fill.fore_color.rgb = C_LIGHT
            p = cell.text_frame.paragraphs[0]
            p.font.size = Pt(11)
            p.font.color.rgb = C_DARK
            if j == 2:
                p.font.bold = True
                p.font.color.rgb = C_BLUE

    # ==================== SLIDE 8: The 11-Second Recovery Breakdown ====================
    slide8 = prs.slides.add_slide(blank_layout)
    add_header(slide8, "Engineering Deep Dive: The 11-Second Recovery")

    box_rec1 = slide8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    box_rec1.fill.solid()
    box_rec1.fill.fore_color.rgb = C_LIGHT
    box_rec1.line.color.rgb = RGBColor(226, 232, 240)
    tf1 = box_rec1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "Where Does the ~11s Go?"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_DARK
    p.space_after = Pt(10)

    for b in [
        "95% of wall-clock time (~10.4s) is pure network I/O waiting on external supplier APIs (Duffel flight booking, LiteAPI hotel reservation).",
        "<0.6s is computational overhead: preference scoring, allocation, 3 negotiation rounds, and OPA policy checks.",
        "Zero GPU on critical path: rule-based preference matching and heuristic ranking run instantly in-memory."
    ]:
        p = tf1.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(13)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(8)

    box_rec2 = slide8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    box_rec2.fill.solid()
    box_rec2.fill.fore_color.rgb = C_LIGHT
    box_rec2.line.color.rgb = RGBColor(226, 232, 240)
    tf2 = box_rec2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "Why Prediction is the Enabler"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_BLUE
    p.space_after = Pt(10)

    for b in [
        "Prediction buys speed, not safety. False positive = 1 API call; false negative = 42 seconds lost.",
        "Pre-caching alternative itineraries before cancellation means the choice set is already in memory when consent arrives.",
        "Safety rests entirely on consent gates and notification ladders—never on a probability score."
    ]:
        p = tf2.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(13)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(8)

    # ==================== SLIDE 9: Limitations, Roadmap & Conclusion ====================
    slide9 = prs.slides.add_slide(blank_layout)
    add_header(slide9, "Honest Limitations, Roadmap & Conclusion")

    box_lim1 = slide9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    box_lim1.fill.solid()
    box_lim1.fill.fore_color.rgb = C_LIGHT
    box_lim1.line.color.rgb = RGBColor(226, 232, 240)
    tf1 = box_lim1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "Honest Limitations"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = RGBColor(185, 28, 28)
    p.space_after = Pt(10)

    for b in [
        "No Indian domestic training data yet: risk model cold-starts to population base rate until retrain loop runs.",
        "Payment is mocked (vPayment contract test; no live payment gateway).",
        "Pull-only API rate limit constraints on flight status feeds."
    ]:
        p = tf1.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    box_lim2 = slide9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    box_lim2.fill.solid()
    box_lim2.fill.fore_color.rgb = C_LIGHT
    box_lim2.line.color.rgb = RGBColor(226, 232, 240)
    tf2 = box_lim2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "Roadmap & Closing"
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_BLUE
    p.space_after = Pt(10)

    for b in [
        "Production Rollout: Live webhook subscriptions & automated event loggers.",
        "Full integration of default-deny policy engine (`server/policy/`).",
        "Elevating American Express cardmember trust through uncompromising proactive service."
    ]:
        p = tf2.add_paragraph()
        p.text = "• " + b
        p.font.size = Pt(12)
        p.font.color.rgb = C_GRAY
        p.space_after = Pt(6)

    # Save presentation
    output_path = r"\\wsl.localhost\Ubuntu\home\dhawal\projects\amex\assets\deck\ZKD_Concierge_Codestreet_2026.pptx"
    prs.save(output_path)
    print(f"Presentation successfully created at: {output_path}")

if __name__ == '__main__':
    create_deck()
