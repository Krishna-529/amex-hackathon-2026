import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Light theme, using the American Express skin the web app already ships.
///
/// Tokens copied verbatim from zkd-app/app/globals.css (:root, ~line 535) so
/// the phone and the website cannot drift apart:
///
///   --amex-blue #016fd0   --amex-bg    #f2f4f7
///   --amex-ink  #00175a   --amex-card  #ffffff
///   --amex-text #1b1b2f   --amex-line  #d8dce3
///   --amex-mist #5c6270   --amex-mist2 #8a90a0
///
/// Note the web app applies this skin to `/`, `/login`, `/flights` and
/// `/flights/*` only — `/recovery` and `/profile` stay dark there, deliberately
/// (see lib/amexRoutes.ts). On a phone a per-screen split would read as a bug
/// rather than a decision, so the whole app is light.
abstract final class Amex {
  static const blue = Color(0xFF016FD0);
  static const ink = Color(0xFF00175A);
  static const text = Color(0xFF1B1B2F);
  static const mist = Color(0xFF5C6270);
  static const mist2 = Color(0xFF8A90A0);
  static const line = Color(0xFFD8DCE3);
  static const line2 = Color(0xFFEEF0F4);
  static const bg = Color(0xFFF2F4F7);
  static const card = Color(0xFFFFFFFF);
}

/// Status colours carry meaning — a red percentage means "this flight is in
/// real trouble" — so they are fixed rather than generated from the seed.
///
/// These are DARKER than the old dark-theme values (#4bab7c / #d3a03f /
/// #d9615a). Those were tuned to sit on #080c14; on white they wash out and
/// fail contrast, which matters most for exactly the number you must not
/// misread.
abstract final class Tones {
  static const brand = Amex.blue;
  static const safe = Color(0xFF1B7A55);
  static const warn = Color(0xFF8A5A00);
  static const risk = Color(0xFFC0392B);
}

Color toneSoft(Color c) => c.withValues(alpha: 0.10);
Color toneEdge(Color c) => c.withValues(alpha: 0.38);

ThemeData buildTheme() {
  final base = ColorScheme.fromSeed(
    seedColor: Amex.blue,
    brightness: Brightness.light,
  );
  // Pin the surfaces and text to the Amex tokens rather than accepting what the
  // seed algorithm produces, so the phone matches the site exactly.
  final scheme = base.copyWith(
    primary: Amex.blue,
    onPrimary: Colors.white,
    surface: Amex.bg,
    onSurface: Amex.text,
    onSurfaceVariant: Amex.mist,
    outlineVariant: Amex.line,
    outline: Amex.mist2,
    error: Tones.risk,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Amex.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Amex.card,
      foregroundColor: Amex.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      // Light bar needs dark status-bar icons, or they vanish into the white.
      systemOverlayStyle: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
      titleTextStyle: TextStyle(
        color: Amex.ink,
        fontSize: 16,
        fontWeight: FontWeight.w700,
      ),
    ),
    cardTheme: CardThemeData(
      color: Amex.card,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Amex.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Amex.blue,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Amex.ink,
        minimumSize: const Size.fromHeight(48),
        side: const BorderSide(color: Amex.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: Amex.blue),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Amex.card,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(11),
        borderSide: const BorderSide(color: Amex.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(11),
        borderSide: const BorderSide(color: Amex.line),
      ),
      labelStyle: const TextStyle(color: Amex.mist),
    ),
    dividerTheme: const DividerThemeData(color: Amex.line, thickness: 1),
    listTileTheme: const ListTileThemeData(contentPadding: EdgeInsets.zero),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: Amex.blue),
  );
}
