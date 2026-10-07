---
'@hyperdx/api': patch
---

Store application metadata and sessions in SQLite for fresh installations. The
API, alert task, and dashboard provisioner share one local database file; the
images and development stack no longer start MongoDB.
