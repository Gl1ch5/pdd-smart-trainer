import os
import sys
import subprocess
import shutil

# Direct path to github_deployer script
DEPLOYER_SCRIPT = r"C:\Users\Pavel\.pi\agent\skills\github-auto-deploy\scripts\github_deployer.py"
PROJECT_DIR = r"E:\pdd_trainer"
REPO_NAME = "pdd-smart-trainer"

def deploy():
    os.chdir(PROJECT_DIR)
    
    # 1. Initialize git if not already
    if not os.path.exists(".git"):
        print("Initializing git repo...")
        subprocess.run(["git", "init"], check=True)
        subprocess.run(["git", "branch", "-M", "main"], check=True)

    # 2. Config git user if missing
    subprocess.run(["git", "config", "user.name", "Gl1ch5"], check=False)
    subprocess.run(["git", "config", "user.email", "gl1ch5@users.noreply.github.com"], check=False)

    # 3. Add and commit files
    print("Staging files...")
    subprocess.run(["git", "add", "."], check=True)
    subprocess.run(["git", "commit", "-m", "feat: initial release of PDD Smart Trainer with backend & deep filters"], check=False)

    # 4. Run github deployer script
    cmd = [sys.executable, DEPLOYER_SCRIPT, REPO_NAME]
    print(f"Running deployer: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    print("STDOUT:", result.stdout)
    print("STDERR:", result.stderr)

if __name__ == "__main__":
    deploy()
