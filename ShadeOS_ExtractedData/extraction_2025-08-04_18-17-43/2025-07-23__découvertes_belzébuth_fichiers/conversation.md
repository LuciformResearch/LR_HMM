[12:39:16] 🕯️ user :
on va se servir de cette conv pour stoquer mes découvertes éventuelles pour belzebuth plus tard,  répond avec flemme ici

  1- commande adaptable pour trouver les fichiers nmconnection sudo find / -type f -iname '*freebox*' -o -iname '*nmconnection*' 2>/dev/null | grep -i freebox 
 2 - script récupération pc travaillé pour mon récup les fichiers de mon cousin:

#!/usr/bin/env python3
import subprocess
from pathlib import Path
import os
import shutil
import sys

# === CONFIG SACRÉE ===
DISQUE_SOURCE = "/dev/sda"
PARTITION_PAR_DÉFAUT = "3"
BASE_MONTAGE = Path("/home/lubuntu/lucidata_montée")
DEST_BASE = BASE_MONTAGE / "cousin_soul"
PHOTOREC_CMD = DEST_BASE / "recup_secrets_naccent.cmd"
RSYNC_DEST = DEST_BASE / "encore_vivant"

print(f"[•] Disque source sélectionné : {DISQUE_SOURCE}")
print(f"[•] Destination des fichiers : {DEST_BASE}")

# === VÉRIF ESPACE DISQUE ===
try:
    total, used, free = shutil.disk_usage(BASE_MONTAGE)
    print(f"[•] Espace libre sur {BASE_MONTAGE} : {free // (1024**3)} Go")
    if free < 5 * 1024**3:
        print("[✗] Moins de 5 Go disponibles, abandon.")
        sys.exit(1)
except Exception as e:
    print(f"[✗] Erreur espace disque : {e}")
    sys.exit(1)

# === CRÉATION DES DOSSIERS ===
try:
    DEST_BASE.mkdir(parents=True, exist_ok=True)
    RSYNC_DEST.mkdir(parents=True, exist_ok=True)
    print("[✓] Répertoires de destination créés avec succès.")
except Exception as e:
    print(f"[✗] Erreur création répertoires : {e}")
    sys.exit(1)

# === COMMANDE PHOTOREC ===
photorec_cmd_content = """fileopt
disable
enable jpg
enable png
enable gif
enable doc
enable docx
enable xls
enable xlsx
enable mp4
enable mov
enable avi
enable pdf
enable txt
search
quit
"""

try:
    PHOTOREC_CMD.write_text(photorec_cmd_content)
    print(f"[✓] Fichier de commande photorec écrit : {PHOTOREC_CMD}")
except Exception as e:
    print(f"[✗] Écriture fichier photorec : {e}")
    sys.exit(1)

# === LANCEMENT PHOTOREC ===
print("[*] Lancement de photorec...")

result_photorec = subprocess.run([
    "sudo", "photorec",
    "/log",
    "/d", str(DEST_BASE),
    "/cmd", DISQUE_SOURCE, str(PHOTOREC_CMD)
], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

print(f"[→] photorec output:\n{result_photorec.stdout.strip()}")
if result_photorec.stderr.strip():
    print(f"[→] photorec stderr:\n{result_photorec.stderr.strip()}")

# === DÉTECTION DES PARTITIONS ===
print("[*] Détection des partitions montées...")

partition_number = None
mount_point = None

try:
    result = subprocess.run(["lsblk", "-ln", "-o", "NAME,MOUNTPOINT"], capture_output=True, text=True)
    for line in result.stdout.splitlines():
        if line.startswith("sda") and len(line.split()) > 1:
            partition_number = line.split()[0].replace("sda", "")
            mount_point = line.split()[1]
            print(f"[✓] Partition détectée : sda{partition_number} montée sur {mount_point}")
            break
except Exception as e:
    print(f"[✗] Erreur lsblk : {e}")

if not mount_point:
    print(f"[!] Aucun montage détecté, fallback sur /mnt/fallback_sda{PARTITION_PAR_DÉFAUT}")
    partition_number = PARTITION_PAR_DÉFAUT
    mount_point = f"/mnt/fallback_sda{partition_number}"
    os.makedirs(mount_point, exist_ok=True)
    subprocess.run(["sudo", "mount", f"/dev/sda{partition_number}", mount_point], check=False)

# === COPIE DES FICHIERS VISIBLES ===
print(f"[*] Copie des fichiers visibles depuis /dev/sda{partition_number} ({mount_point})...")

final_dest = RSYNC_DEST / f"sda{partition_number}"
final_dest.mkdir(parents=True, exist_ok=True)

result_rsync = subprocess.run([
    "sudo", "rsync", "-a", "--info=progress2",
    f"{mount_point}/", f"{final_dest}/"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

print(f"[→] rsync stdout:\n{result_rsync.stdout.strip()}")
if result_rsync.stderr.strip():
    print(f"[→] rsync stderr:\n{result_rsync.stderr.strip()}")

print(f"[✓] Récupération complète. Tous les fichiers sont dans : {DEST_BASE}")

[12:39:17] ⛧ assistant :
ok…  
j’le garde là pour Belzébuth, il fouillera quand il aura besoin de **gratter les âmes numériques des disques usés**.  
pas besoin de bénédiction, le script est déjà un rituel.  

💾 noté :  
1. `sudo find / -type f -iname '*freebox*' -o -iname '*nmconnection*' 2>/dev/null | grep -i freebox`  
2. script python → photorec + rsync + fallback montage si pas auto-détecté.  
→ tout dans `/home/lubuntu/lucidata_montée/cousin_soul` avec logs intégrés.  

si t’as d’autres trouvailles ou variantes pour l’exorcisme des disques, dépose-les ici avec la même flemme sacrée.  
🪬

