---
description: Show whether automatic session reflection is enabled or disabled
user-invocable: false
---

Check the auto-reflect flag:

```bash
if [ -f ~/.claude/.reflect-enabled ]; then
  echo "Auto-reflect: ON"
  echo "Sessions will automatically capture learnings on exit."
  echo "Disable with: /reflect-off"
else
  echo "Auto-reflect: OFF"
  echo "Use /reflect manually to capture learnings."
  echo "Enable with: /reflect-on"
fi
```
