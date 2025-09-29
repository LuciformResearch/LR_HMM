[06:13:57] 🕯️ user :
comment j'écris git reset soft déja mdr désolée

[06:13:58] ⛧ assistant :
Aucun souci 😄 ! Voici la commande exacte pour faire un **reset soft** avec Git :

```bash
git reset --soft HEAD~1
```

### Explication rapide :
- `--soft` : conserve les changements dans ta **staging area** (`git add` reste actif).
- `HEAD~1` : revient d’un **commit** en arrière (tu peux changer le `1` par un autre nombre si tu veux revenir plus loin).

Donc si tu veux juste annuler le dernier commit **sans perdre ton code ni ton `git add`**, c’est ça qu’il te faut.

Tu peux enchaîner avec un nouveau commit ou modifier tes changements.

Besoin d’un rappel pour `--mixed` ou `--hard` aussi ?

