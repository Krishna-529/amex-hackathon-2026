import 'package:flutter_test/flutter_test.dart';

import 'package:zkdconcierge/util/time.dart';

void main() {
  test('money uses Indian digit grouping', () {
    expect(money(0), '₹0');
    expect(money(950), '₹950');
    expect(money(12340), '₹12,340');
    expect(money(1234567), '₹12,34,567');
  });

  test('secs matches the latency-budget formatting', () {
    expect(secs(0.4), '0.40s');
    expect(secs(3.4), '3.4s');
    expect(secs(42), '42s');
    expect(secs(11.41), '11.4s');
  });

  test('durLabel zero-pads minutes', () {
    expect(durLabel(125), '2h 05m');
  });

  test('dayLabel names today and tomorrow', () {
    final now = DateTime(2026, 8, 19, 9);
    expect(dayLabel(DateTime(2026, 8, 19, 18), now), 'Today, 19 Aug');
    expect(dayLabel(DateTime(2026, 8, 20, 6), now), 'Tomorrow, 20 Aug');
    expect(dayLabel(DateTime(2026, 8, 18, 6), now), 'Yesterday');
  });
}
