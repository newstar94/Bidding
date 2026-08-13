---
status: accepted
---

# Sensitive record read is separate from document export

`sensitive.record.read` and `sensitive.document.export` are independent grants because viewing a bank account, identity value, signature, or stamp in an interactive record is a different disclosure from placing it in an official document. Existing document-export grants are not copied into record-read grants during upgrade; ordinary members therefore remain fail-closed until a manager explicitly grants record read, while manager and personal-owner inheritance remains explicit policy.
