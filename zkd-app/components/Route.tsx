import type { Flight } from '@/lib/data';

export default function RouteLine({ f }: { f: Pick<Flight, 'from' | 'to' | 'dep' | 'arr' | 'dur'> }) {
  return (
    <div className="route">
      <div className="port"><div className="ap">{f.from}</div><div className="tm">{f.dep}</div></div>
      <div className="mid"><div className="dur">{f.dur}</div><div className="line" /></div>
      <div className="port to"><div className="ap">{f.to}</div><div className="tm">{f.arr}</div></div>
    </div>
  );
}
