set -e
if [ -f package-lock.json ]; then npm ci; fi
if [ -f package.json ]; then npm run lint --if-present; fi
if [ -f package.json ]; then npm run build --if-present; fi
if [ -f package.json ]; then npm run test --if-present; fi
