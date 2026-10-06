# Hide Word navigation for the free package

Status: Accepted by product owner, 2026-10-06.

The active workspace whose subscription package_id is free hides the entire
Hệ thống văn bản sidebar group, including Biểu mẫu Word and Xuất bản Word.
Switching to a paid workspace restores the group subject to existing role UI.
An unsubscribed workspace with word_export=false uses the same free presentation.
Trial/platform access with word_export=true is preserved. Role-menu rendering
reapplies the presentation for the active workspace.
Role CSS must respect the hidden attribute rather than forcing free navigation
visible. A Chromium regression uses the actual sidebar, components CSS and
personal access payload to verify both hiding and restoration after upgrade.

This is a navigation presentation change. Existing export authorization,
record display, module permissions and backend contracts remain unchanged.
No database migration is required. Existing subscriptions continue to identify
the free package by package_id. The regression test is
tests/js/free_word_navigation.test.mjs.
