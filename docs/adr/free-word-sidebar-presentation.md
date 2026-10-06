# Hide Word navigation for the free package

Status: Accepted by product owner, 2026-10-06.

The active workspace whose subscription package_id is free hides the entire
Hệ thống văn bản sidebar group, including Biểu mẫu Word and Xuất bản Word.
Switching to a paid workspace restores the group subject to existing role UI.

This is a navigation presentation change. Existing export authorization,
record display, module permissions and backend contracts remain unchanged.
No database migration is required. Existing subscriptions continue to identify
the free package by package_id. The regression test is
tests/js/free_word_navigation.test.mjs.
