/// Display formatters, ported from zkd-android/src/lib/time.ts.
///
/// Hand-rolled rather than delegated to intl's locale data: these need to match
/// the web app's output exactly, and the money format is Indian digit grouping
/// (lakh/crore), which is not the same as splitting on every three digits.
const List<String> _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _p2(int n) => n.toString().padLeft(2, '0');

String hhmm(DateTime d) => '${_p2(d.hour)}:${_p2(d.minute)}';

String ddMon(DateTime d) => '${d.day} ${_months[d.month - 1]}';

DateTime _midnight(DateTime d) => DateTime(d.year, d.month, d.day);

/// "Today, 19 Aug" / "Tomorrow, 19 Aug" / "Yesterday" / "19 Aug 2027"
String dayLabel(DateTime d, DateTime now) {
  final diff = _midnight(d).difference(_midnight(now)).inDays;
  if (diff == 0) return 'Today, ${ddMon(d)}';
  if (diff == 1) return 'Tomorrow, ${ddMon(d)}';
  if (diff == -1) return 'Yesterday';
  return ddMon(d) + (d.year != now.year ? ' ${d.year}' : '');
}

/// "42 seconds ago", "3 minutes ago", "2 hours ago", "5 days ago", "1.5 years ago"
String agoLabel(DateTime d, DateTime now) {
  final s = now.difference(d).inSeconds;
  final sec = s < 0 ? 0 : s;
  if (sec < 60) return '$sec seconds ago';
  final m = (sec / 60).round();
  if (m < 60) return '$m ${m == 1 ? 'minute' : 'minutes'} ago';
  final h = (m / 60).round();
  if (h < 24) return '$h ${h == 1 ? 'hour' : 'hours'} ago';
  final dd = (h / 24).round();
  if (dd < 14) return '$dd ${dd == 1 ? 'day' : 'days'} ago';
  if (dd < 70) return '${(dd / 7).round()} weeks ago';
  final mo = (dd / 30).round();
  if (mo < 18) return '$mo months ago';
  final y = (dd / 365).toStringAsFixed(1).replaceAll(RegExp(r'\.0$'), '');
  return '$y ${y == '1' ? 'year' : 'years'} ago';
}

/// "2h 05m"
String durLabel(int minutes) => '${minutes ~/ 60}h ${_p2(minutes % 60)}m';

/// Seconds the way an engineer reads a latency budget: "0.40s", "3.4s", "42s".
String secs(num n) {
  final t = n < 1 ? n.toStringAsFixed(2) : n.toStringAsFixed(1);
  return '${t.replaceAll(RegExp(r'\.0$'), '')}s';
}

/// Indian digit grouping: 1234567 -> "12,34,567". Zero is "₹0", never "".
String money(num n) {
  if (n == 0) return '₹0';
  final neg = n < 0;
  final digits = n.abs().round().toString();
  String grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    final last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = '${parts.join(',')},$last3';
  }
  return '₹${neg ? '-' : ''}$grouped';
}
