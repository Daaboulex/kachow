---
description: Disable automatic session reflection (Stop hook will no longer trigger /reflect)
user-invocable: false
---

Disable auto-reflect by removing the flag file:

```bash
rm -f ~/.claude/.reflect-enabled
```

Then confirm: "Auto-reflect disabled. Use /reflect manually to capture learnings."
