import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../fixtures.dart';
import '../state/world.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// The only screen in the app that shows an error. Everything else fails
/// silently and keeps the last good value.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  static const route = '/login';

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await context.read<World>().signIn(_email.text, _password.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
    // On success there is no navigation: World.status flips to authenticated
    // and the root swaps the whole route set.
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('ZKD Concierge')),
      body: PageBody(
        children: [
          const PageHead(
            'Sign in',
            lede: Text(
              'This is your card member account — it is how we know which '
              'trips, preferences and payment method are yours.',
            ),
          ),
          if (_error != null) ...[
            Card(
              color: toneSoft(Tones.warn),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(_error!, style: const TextStyle(color: Tones.warn)),
              ),
            ),
            const SizedBox(height: 14),
          ],
          PanelCard(
            title: 'Card member sign in',
            children: [
              TextField(
                controller: _email,
                autocorrect: false,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Email'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                obscureText: true,
                onSubmitted: (_) => _busy ? null : _submit(),
                decoration: const InputDecoration(labelText: 'Password'),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? 'Signing in…' : 'Sign in'),
              ),
            ],
          ),
          const SizedBox(height: 14),
          PanelCard(
            title: 'Demo accounts',
            children: [
              for (final a in demoAccounts)
                InkWell(
                  // Fills the form only. Deliberately does not submit, so the
                  // password stays visible long enough to be read off-screen.
                  onTap: () {
                    _email.text = a.email;
                    _password.text = a.password;
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    child: Row(
                      children: [
                        Expanded(child: Text(a.name)),
                        Text(
                          a.email,
                          style: TextStyle(color: scheme.primary, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              const Why(
                'Every seeded account uses its own password — tap a name to '
                'fill the form. This is a prototype fixture, not how a real '
                'card member would authenticate.',
              ),
            ],
          ),
        ],
      ),
    );
  }
}
