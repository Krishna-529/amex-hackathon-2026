import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn


def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # ---- Claude brand palette ----
    # Warm cream paper background, ink text, "Book Cloth" coral/clay accent.
    C_BG = RGBColor(0xFA, 0xF9, 0xF5)          # Cloud — page background
    C_CARD = RGBColor(0xFF, 0xFF, 0xFF)        # card surface
    C_CARD_ALT = RGBColor(0xF0, 0xEE, 0xE6)    # secondary card / kraft tint
    C_INK = RGBColor(0x1F, 0x1E, 0x1C)         # near-black warm ink
    C_INK_SOFT = RGBColor(0x5E, 0x5A, 0x52)    # muted body text
    C_CLAY = RGBColor(0xD9, 0x77, 0x57)        # Claude coral / Book Cloth
    C_CLAY_DARK = RGBColor(0xB8, 0x5C, 0x3E)
    C_CLAY_TINT = RGBColor(0xF3, 0xE3, 0xDB)   # pale coral card wash
    C_LINE = RGBColor(0xE4, 0xE0, 0xD6)        # hairline border
    C_GOOD_TXT = RGBColor(0x3F, 0x5D, 0x3A)
    C_GOOD_BG = RGBColor(0xE7, 0xEE, 0xE2)
    C_GOOD_LINE = RGBColor(0xC9, 0xD9, 0xC0)
    C_BAD_TXT = RGBColor(0x8A, 0x3B, 0x2E)
    C_BAD_BG = RGBColor(0xF4, 0xE4, 0xDF)
    C_BAD_LINE = RGBColor(0xE3, 0xC3, 0xB8)
    C_DARK_PANEL = RGBColor(0x2A, 0x28, 0x24)  # near-ink panel for the title slide

    FONT_SERIF = "Georgia"       # display / headline face (Claude uses a warm serif)
    FONT_SANS = "Avenir Next"    # body face fallback chain resolved by the OS

    blank_layout = prs.slide_layouts[6]

    # ---------------- helpers ----------------

    def set_background(slide, color):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = color
        bg.line.fill.background()
        bg.shadow.inherit = False
        # send to back
        sp = bg._element
        sp.getparent().remove(sp)
        slide.shapes._spTree.insert(2, sp)
        return bg

    def no_shadow(shape):
        shape.shadow.inherit = False

    def rounded_card(slide, left, top, width, height, fill=C_CARD, line_color=C_LINE, radius=0.06):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        try:
            card.adjustments[0] = radius
        except Exception:
            pass
        card.fill.solid()
        card.fill.fore_color.rgb = fill
        card.line.color.rgb = line_color
        card.line.width = Pt(0.75)
        no_shadow(card)
        return card

    def accent_rule(slide, left, top, width=Inches(0.55), height=Pt(3.5), color=C_CLAY):
        rule = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
        rule.fill.solid()
        rule.fill.fore_color.rgb = color
        rule.line.fill.background()
        no_shadow(rule)
        return rule

    def kicker(slide, text, left=Inches(0.8), top=Inches(0.55), width=Inches(11.7)):
        box = slide.shapes.add_textbox(left, top, width, Inches(0.35))
        tf = box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = text.upper()
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.name = FONT_SANS
        p.font.color.rgb = C_CLAY_DARK
        try:
            p.font._rPr.set(qn('spc'), "150")
        except Exception:
            pass
        return box

    def add_header(slide, title_text, category_text="ZKD CONCIERGE  ·  AMERICAN EXPRESS  /  CODESTREET 2026", page_no=None):
        set_background(slide, C_BG)
        kicker(slide, category_text)

        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.88), Inches(11.0), Inches(0.85))
        tf = title_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title_text
        p.font.size = Pt(27)
        p.font.bold = False
        p.font.name = FONT_SERIF
        p.font.color.rgb = C_INK

        accent_rule(slide, Inches(0.8), Inches(1.62))

        if page_no is not None:
            pn = slide.shapes.add_textbox(Inches(12.5), Inches(7.05), Inches(0.6), Inches(0.35))
            ptf = pn.text_frame
            pp = ptf.paragraphs[0]
            pp.text = f"{page_no:02d}"
            pp.font.size = Pt(10)
            pp.font.name = FONT_SANS
            pp.font.color.rgb = C_INK_SOFT
            pp.alignment = PP_ALIGN.RIGHT

    def bullet_block(text_frame, items, size=12.5, color=C_INK_SOFT, space_after=8, first_new=False, bold_lead=False):
        for i, b in enumerate(items):
            p = text_frame.paragraphs[0] if (i == 0 and not first_new) else text_frame.add_paragraph()
            p.text = "—  " + b
            p.font.size = Pt(size)
            p.font.name = FONT_SANS
            p.font.color.rgb = color
            p.space_after = Pt(space_after)
            p.line_spacing = 1.18

    def panel_title(text_frame, text, color=C_INK, size=16.5, space_after=12, subtle=None):
        p = text_frame.paragraphs[0]
        p.text = text
        p.font.size = Pt(size)
        p.font.bold = True
        p.font.name = FONT_SERIF
        p.font.color.rgb = color
        p.space_after = Pt(space_after)
        if subtle:
            p2 = text_frame.add_paragraph()
            p2.text = subtle
            p2.font.size = Pt(11)
            p2.font.name = FONT_SANS
            p2.font.color.rgb = C_INK_SOFT
            p2.space_after = Pt(space_after)

    def pad(text_frame, inset=0.28):
        text_frame.margin_left = Inches(inset)
        text_frame.margin_right = Inches(inset)
        text_frame.margin_top = Inches(inset)
        text_frame.margin_bottom = Inches(inset)
        text_frame.word_wrap = True

    # ==================== SLIDE 1: Title ====================
    slide1 = prs.slides.add_slide(blank_layout)
    set_background(slide1, C_DARK_PANEL)

    # subtle coral corner mark, Claude's asterisk-like motif via a simple shape
    mark = slide1.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.9), Inches(0.95), Inches(0.16), Inches(0.16))
    mark.fill.solid()
    mark.fill.fore_color.rgb = C_CLAY
    mark.line.fill.background()
    no_shadow(mark)

    tb1 = slide1.shapes.add_textbox(Inches(1.0), Inches(2.15), Inches(11.0), Inches(3.6))
    tf1 = tb1.text_frame
    pad(tf1, 0)

    p0 = tf1.paragraphs[0]
    p0.text = "CODESTREET 2026  /  AMERICAN EXPRESS"
    p0.font.size = Pt(13)
    p0.font.bold = True
    p0.font.name = FONT_SANS
    p0.font.color.rgb = C_CLAY
    p0.space_after = Pt(16)

    p1 = tf1.add_paragraph()
    p1.text = "ZKD Concierge"
    p1.font.size = Pt(52)
    p1.font.bold = False
    p1.font.name = FONT_SERIF
    p1.font.color.rgb = RGBColor(0xF7, 0xF5, 0xF0)
    p1.space_after = Pt(10)

    p2 = tf1.add_paragraph()
    p2.text = "An autonomous travel-disruption concierge for Indian domestic aviation"
    p2.font.size = Pt(19)
    p2.font.name = FONT_SANS
    p2.font.color.rgb = RGBColor(0xC9, 0xC3, 0xB8)
    p2.space_after = Pt(28)

    p3 = tf1.add_paragraph()
    p3.text = "Team ZKD · IIT Madras   —   Live MVP presentation (20 min pitch + 10 min Q&A)"
    p3.font.size = Pt(12.5)
    p3.font.name = FONT_SANS
    p3.font.color.rgb = RGBColor(0x9A, 0x94, 0x8A)

    accent_rule(slide1, Inches(1.0), Inches(2.02), width=Inches(0.55), color=C_CLAY)

    # ==================== SLIDE 2: The Passenger Reality ====================
    slide2 = prs.slides.add_slide(blank_layout)
    add_header(slide2, "The passenger reality: from panic to peace of mind", page_no=2)

    box_old = rounded_card(slide2, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65), fill=C_BAD_BG, line_color=C_BAD_LINE)
    tf_old = box_old.text_frame
    pad(tf_old)
    panel_title(tf_old, "Today — the reactive IRROPS nightmare", color=C_BAD_TXT, size=16)
    bullet_block(tf_old, [
        "Discovering the cancellation only at the gate or via a delayed SMS.",
        "45+ minute hold times with airline customer care centres.",
        "Scrambling for overpriced alternate flights and airport hotels.",
        "Opaque DGCA duty-of-care claims requiring manual paperwork.",
    ], color=C_BAD_TXT, first_new=True)

    box_new = rounded_card(slide2, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_GOOD_BG, line_color=C_GOOD_LINE)
    tf_new = box_new.text_frame
    pad(tf_new)
    panel_title(tf_new, "ZKD Concierge — proactive and autonomous", color=C_GOOD_TXT, size=16)
    bullet_block(tf_new, [
        "Predictive warning ~42s before the formal airline cancellation.",
        "Instant push notification with pre-cached flight, hotel and ground options.",
        "1-tap pre-authorisation, or autopilot protection, with no phone queues.",
        "Automatic compensation claims and zero out-of-pocket stress.",
    ], color=C_GOOD_TXT, first_new=True)

    # ==================== SLIDE 3: Live MVP Demo Flow ====================
    slide3 = prs.slides.add_slide(blank_layout)
    add_header(slide3, "Live MVP demo walkthrough (pre-tea-break hero flow)", page_no=3)

    steps = [
        ("01", "Operator console (/ops)", "Trigger test disruptions locally or hosted; exercises the webhook and poller simulation channels instantly."),
        ("02", "Risk & LLM explanation", "Live risk gauge crossing thresholds, with a plain-language Gemini explanation of the weather/airline risk."),
        ("03", "Edge case: self-cancel", "Member-initiated changes, a clean hand-off (`handed-over`), and zero-friction state sync."),
        ("04", "11-second autonomous recovery", "Pre-auth consent gate, multi-supplier option ranking, and 1-tap booking confirmation in ~11s."),
    ]

    for i, (num, stitle, sdesc) in enumerate(steps):
        col = i % 2
        row = i // 2
        left = Inches(0.8 + col * 6.0)
        top = Inches(1.95 + row * 2.42)

        card = rounded_card(slide3, left, top, Inches(5.7), Inches(2.15), fill=C_CARD, line_color=C_LINE)
        tf = card.text_frame
        pad(tf)

        p = tf.paragraphs[0]
        p.text = f"{num}   {stitle}"
        p.font.size = Pt(15.5)
        p.font.bold = True
        p.font.name = FONT_SERIF
        p.font.color.rgb = C_CLAY_DARK
        p.space_after = Pt(8)

        p2 = tf.add_paragraph()
        p2.text = sdesc
        p2.font.size = Pt(12.5)
        p2.font.name = FONT_SANS
        p2.font.color.rgb = C_INK_SOFT
        p2.line_spacing = 1.2

    # ==================== SLIDE 4: Predictive ML + Personalization ====================
    slide4 = prs.slides.add_slide(blank_layout)
    add_header(slide4, "Predictive ML model & personalization — the Spotify analogy", page_no=4)

    box_ml1 = rounded_card(slide4, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65))
    tf1 = box_ml1.text_frame
    pad(tf1)
    panel_title(tf1, "Self-trained cancellation risk model", size=16)
    bullet_block(tf1, [
        "Built in zkd-risk-model/: XGBoost trained on real US DOT/BTS and Brazil ANAC historical data.",
        "Extracts weather, route congestion, and airline rolling delays.",
        "Outputs a continuous probability score with adaptive thresholds — not a flat 25/55/80.",
        "Advisory role only: decides when we start preparing, never whether we spend member money.",
    ], first_new=True)

    box_ml2 = rounded_card(slide4, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_CLAY_TINT, line_color=C_LINE)
    tf2 = box_ml2.text_frame
    pad(tf2)
    panel_title(tf2, "Personalization: the Spotify / YouTube analogy", color=C_CLAY_DARK, size=16)
    bullet_block(tf2, [
        "Just as Spotify curates Discover Weekly from listening history, ZKD learns cardmember preferences.",
        "Captures seat preference, cabin entitlement, layover tolerance, and companion rules.",
        "Translates free-text member intent (server/preferences/intent.ts) into weighted scoring rules.",
        "Dynamic adaptation: refines options from implicit choices and explicit feedback.",
    ], first_new=True)

    # ==================== SLIDE 5: Lifecycle Workflow ====================
    slide5 = prs.slides.add_slide(blank_layout)
    add_header(slide5, "The disruption lifecycle — prediction buys speed", page_no=5)

    phases = [
        ("01", "Predict", "~42s head start", "Model forecasts cancellation probability before the airline files it. Alt flights and hotels are pre-cached warm."),
        ("02", "Pre-cache", "Zero spend, no hold", "Options are priced and held warm in memory. No booking, no spend, no financial liability."),
        ("03", "Consent gate", "Member control", "A high-risk threshold triggers pre-auth. The member chooses, or approves autopilot in advance."),
        ("04", "Act & settle", "~11s recovery", "The confirmed booking executes instantly. DGCA duty-of-care claims are filed automatically."),
    ]

    for i, (num, ptitle, psub, pdesc) in enumerate(phases):
        left = Inches(0.8 + i * 2.93)
        card = rounded_card(slide5, left, Inches(2.05), Inches(2.73), Inches(4.35))
        tf = card.text_frame
        pad(tf, 0.22)

        p = tf.paragraphs[0]
        p.text = num
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.name = FONT_SANS
        p.font.color.rgb = C_INK_SOFT
        p.space_after = Pt(4)

        p_t = tf.add_paragraph()
        p_t.text = ptitle
        p_t.font.size = Pt(16)
        p_t.font.bold = True
        p_t.font.name = FONT_SERIF
        p_t.font.color.rgb = C_INK
        p_t.space_after = Pt(2)

        p_sub = tf.add_paragraph()
        p_sub.text = psub
        p_sub.font.size = Pt(11)
        p_sub.font.bold = True
        p_sub.font.name = FONT_SANS
        p_sub.font.color.rgb = C_CLAY_DARK
        p_sub.space_after = Pt(14)

        p_desc = tf.add_paragraph()
        p_desc.text = pdesc
        p_desc.font.size = Pt(11.5)
        p_desc.font.name = FONT_SANS
        p_desc.font.color.rgb = C_INK_SOFT
        p_desc.line_spacing = 1.2

        if i < len(phases) - 1:
            accent_rule(slide5, Inches(0.8 + i * 2.93) + Inches(2.73) + Inches(0.02), Inches(4.15), width=Pt(3), height=Inches(0.14), color=C_LINE)

    # ==================== SLIDE 6: Policy Intelligence via RAG ====================
    slide6 = prs.slides.add_slide(blank_layout)
    add_header(slide6, "Policy intelligence via RAG & multi-regulation compliance", page_no=6)

    box_rag1 = rounded_card(slide6, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65))
    tf1 = box_rag1.text_frame
    pad(tf1)
    panel_title(tf1, "Multi-regulation scope (beyond DGCA)", size=16)
    bullet_block(tf1, [
        "Not just DGCA (Indian domestic aviation) — international frameworks too: EU261 and UK261.",
        "Carrier-specific contract clauses and operating terms (e.g. British Airways vs Emirates entitlements).",
        "Amex card product benefit terms (server/myca.ts): cabin ceilings, lounge access, per-transaction rules.",
        "Jurisdiction routing automatically detects which regulatory framework governs the PNR.",
    ], first_new=True)

    box_rag2 = rounded_card(slide6, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_CLAY_TINT, line_color=C_LINE)
    tf2 = box_rag2.text_frame
    pad(tf2)
    panel_title(tf2, "RAG & default-deny policy engine", color=C_CLAY_DARK, size=16)
    bullet_block(tf2, [
        "RAG ingestion automatically vectorizes and indexes aviation regulations, fare rules, and card terms.",
        "Context retrieval dynamically queries relevant clauses when a disruption occurs for a given PNR.",
        "OPA policy gate (server/policy/): default-deny rule engine, evaluated in-process in under 1ms.",
        "Incomplete policy inputs trigger default-deny — nothing executes without an explicit allow.",
    ], first_new=True)

    # ==================== SLIDE 7: Architecture & Multi-Device Sync ====================
    slide7 = prs.slides.add_slide(blank_layout)
    add_header(slide7, "System architecture & multi-device state sync", page_no=7)

    box_arch1 = rounded_card(slide7, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65))
    tf1 = box_arch1.text_frame
    pad(tf1)
    panel_title(tf1, "Server-authoritative simulation engine", size=16)
    bullet_block(tf1, [
        "Module-level simulation engine (server/engine/simulation.ts) runs the whole lifecycle.",
        "Real setTimeout/setInterval chains resolve on schedule whether devices watch or not.",
        "Single source of truth: the shared state ledger (server/decisionLedger.ts).",
        "Zero GPU on the critical path — 95% of the time is network wait on supplier APIs.",
    ], first_new=True)

    box_arch2 = rounded_card(slide7, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_CLAY_TINT, line_color=C_LINE)
    tf2 = box_arch2.text_frame
    pad(tf2)
    panel_title(tf2, "Multi-device sync & identity switchers", color=C_CLAY_DARK, size=16)
    bullet_block(tf2, [
        "Stateless clients: the Next.js web app (zkd-app/) and the Expo React Native app (zkd-android/).",
        "Clean polling architecture: GET /api/passengers/[id]/schedule.",
        "Identity switcher (?as=p-priya vs ?as=p-arjun): two tabs side by side prove independent tenant state.",
        "Actions on mobile and web instantly converge via the shared backend.",
    ], first_new=True)

    # ==================== SLIDE 8: Honest Experience KPIs Matrix ====================
    slide8 = prs.slides.add_slide(blank_layout)
    add_header(slide8, "Customer experience KPIs — strictly no revenue proxies", page_no=8)

    rows, cols = 5, 4
    left = Inches(0.8)
    top = Inches(1.95)
    width = Inches(11.73)
    height = Inches(4.6)

    table_shape = slide8.shapes.add_table(rows, cols, left, top, width, height)
    table = table_shape.table
    table.columns[0].width = Inches(2.2)
    table.columns[1].width = Inches(3.23)
    table.columns[2].width = Inches(1.9)
    table.columns[3].width = Inches(4.4)

    headers = ["Category", "Metric name", "Status", "System evidence / reality"]
    for j, h in enumerate(headers):
        cell = table.cell(0, j)
        cell.text = h
        cell.fill.solid()
        cell.fill.fore_color.rgb = C_INK
        cell.margin_left = Inches(0.14)
        cell.margin_top = Inches(0.08)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = cell.text_frame.paragraphs[0]
        p.font.bold = True
        p.font.size = Pt(11.5)
        p.font.name = FONT_SANS
        p.font.color.rgb = RGBColor(0xF7, 0xF5, 0xF0)

    kpi_data = [
        ("Speed", "Time to Plan Ready (A2)", "EXISTS", "~11s measured via the pipeline journal (journal.ts)."),
        ("Member effort", "Hand-off Rate (B2)", "EXISTS", "Tracked via DisruptionResolution.kind === 'handed-over'."),
        ("Outcome quality", "Plan Acceptance Rate (C1)", "EXISTS", "Resolved as approved/autopilot over total recoveries."),
        ("Trust & loyalty", "Autopilot Opt-in (E2)", "EXISTS", "Share of members trusting the system unsupervised."),
    ]

    for i, row_vals in enumerate(kpi_data):
        for j, val in enumerate(row_vals):
            cell = table.cell(i + 1, j)
            cell.text = val
            cell.fill.solid()
            cell.fill.fore_color.rgb = C_CARD if i % 2 == 0 else C_CARD_ALT
            cell.margin_left = Inches(0.14)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            p = cell.text_frame.paragraphs[0]
            p.font.size = Pt(11)
            p.font.name = FONT_SANS
            p.font.color.rgb = C_INK_SOFT
            if j == 2:
                p.font.bold = True
                p.font.color.rgb = C_CLAY_DARK
            if j == 0:
                p.font.color.rgb = C_INK

    # remove default table style borders look by leaving pptx defaults (kept minimal)

    # ==================== SLIDE 9: The 11-Second Recovery Breakdown ====================
    slide9 = prs.slides.add_slide(blank_layout)
    add_header(slide9, "Engineering deep dive: the 11-second recovery", page_no=9)

    box_rec1 = rounded_card(slide9, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65))
    tf1 = box_rec1.text_frame
    pad(tf1)
    panel_title(tf1, "Where does the ~11s go?", size=16)
    bullet_block(tf1, [
        "95% of wall-clock time (~10.4s) is pure network I/O waiting on external supplier APIs (Duffel flight booking, LiteAPI hotel reservation).",
        "Under 0.6s is computational overhead: preference scoring, allocation, 3 negotiation rounds, and OPA policy checks.",
        "Zero GPU on the critical path — rule-based preference matching and heuristic ranking run instantly in-memory.",
    ], size=13, first_new=True)

    box_rec2 = rounded_card(slide9, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_CLAY_TINT, line_color=C_LINE)
    tf2 = box_rec2.text_frame
    pad(tf2)
    panel_title(tf2, "Why prediction is the enabler", color=C_CLAY_DARK, size=16)
    bullet_block(tf2, [
        "Prediction buys speed, not safety. A false positive costs one API call; a false negative costs 42 seconds.",
        "Pre-caching alternative itineraries before cancellation means the choice set is already in memory when consent arrives.",
        "Safety rests entirely on consent gates and notification ladders — never on a probability score.",
    ], size=13, first_new=True)

    # ==================== SLIDE 10: Limitations, Roadmap & Conclusion ====================
    slide10 = prs.slides.add_slide(blank_layout)
    add_header(slide10, "Honest limitations, roadmap & conclusion", page_no=10)

    box_lim1 = rounded_card(slide10, Inches(0.8), Inches(1.95), Inches(5.6), Inches(4.65), fill=C_BAD_BG, line_color=C_BAD_LINE)
    tf1 = box_lim1.text_frame
    pad(tf1)
    panel_title(tf1, "Honest limitations", color=C_BAD_TXT, size=16)
    bullet_block(tf1, [
        "No Indian domestic training data yet: the risk model cold-starts to a population base rate until the retrain loop runs.",
        "Payment is mocked — a vPayment contract test, no live payment gateway.",
        "Pull-only API rate-limit constraints on flight status feeds.",
    ], color=C_BAD_TXT, first_new=True)

    box_lim2 = rounded_card(slide10, Inches(6.85), Inches(1.95), Inches(5.65), Inches(4.65), fill=C_GOOD_BG, line_color=C_GOOD_LINE)
    tf2 = box_lim2.text_frame
    pad(tf2)
    panel_title(tf2, "Roadmap & closing", color=C_GOOD_TXT, size=16)
    bullet_block(tf2, [
        "Production rollout: live webhook subscriptions and automated event loggers.",
        "Full integration of the default-deny policy engine (server/policy/).",
        "Elevating American Express cardmember trust through uncompromising proactive service.",
    ], color=C_GOOD_TXT, first_new=True)

    # Save presentation
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_path = os.path.join(repo_root, "assets", "deck", "ZKD_Concierge_Codestreet_2026.pptx")
    prs.save(output_path)
    print(f"Presentation successfully created at: {output_path}")


if __name__ == '__main__':
    create_deck()
