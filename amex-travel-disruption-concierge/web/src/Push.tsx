/**
 * The disruption push, on a 9:16 phone frame.
 *
 * One affirmative control ("Rebook me"). The Card Member is told what broke
 * and what the concierge proposes; she is not asked to solve it.
 */
export function Push({ push }: { push: any }) {
  const proposal = push.proposal;

  return (
    <div className="phone-stage" id="phone-stage">
      <div className="phone">
        <div className="phone-screen">
          <div className="notch" />
          <div className="phone-status">
            <span>{push.time}</span>
            <span>5G ▮▮▮</span>
          </div>

          <div className="lock-time">
            <div className="t">{push.time}</div>
            <div className="d">Tuesday, 25 August</div>
          </div>

          <div className="notif">
            <div className="notif-head">
              <span className="notif-icon">A</span>
              <span className="notif-app">{push.appName}</span>
              <span className="notif-time">now</span>
            </div>

            <div className="notif-title">{push.title}</div>
            <div className="notif-body">{push.body}</div>

            <div className="leg-strip">
              <div>
                <div className="route">{push.cancelledLeg.sector}</div>
                <div className="meta">
                  {push.cancelledLeg.flight} · dep {push.cancelledLeg.scheduled} IST
                </div>
              </div>
              <span className="cancel-tag">CANCELLED</span>
            </div>

            {proposal && (
              <div className="fix-strip">
                <div>
                  <div className="route">{push.cancelledLeg.sector}</div>
                  <div className="meta">{proposal.detail}</div>
                </div>
                <span className="cost">{proposal.costLabel}</span>
              </div>
            )}

            <div className="notif-actions">
              <button className="btn-primary">{push.affirmativeControl}</button>
              <button className="btn-secondary">{push.secondaryControl}</button>
            </div>

            <div className="notif-foot">
              Hotel and transfer covered under DGCA duty of care
            </div>
          </div>

          <div className="home-bar" />
        </div>
      </div>
    </div>
  );
}
