# Review: task 013

## Commits (0f47e8d6574564e44f4f977b8da54d863cc2e94c..HEAD)


## Diffstat (0f47e8d6574564e44f4f977b8da54d863cc2e94c -> working tree)

 .mvp/ledger.md                      |    2 +
 package-lock.json                   | 1323 ++++++++++++++++++++++++++++++++---
 services/frontend/package.json      |    3 +-
 services/frontend/src/App.test.tsx  |   28 +-
 services/frontend/src/api/client.ts |   24 +-
 services/frontend/src/api/types.ts  |  100 +++
 services/frontend/src/index.css     |   68 ++
 services/frontend/src/routes.tsx    |   73 +-
 8 files changed, 1485 insertions(+), 136 deletions(-)

## Diff (0f47e8d6574564e44f4f977b8da54d863cc2e94c -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index 09208a2..cd3e86e 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -15,3 +15,5 @@ Task 021: complete (ef5b165088ce97781679ac01da85f9b2fb44a5c5)
   Ruling (task 021): не переигрываю задачу — изменение сводилось к сужению glob-области гейта и правке комментариев, диффы проверены и закоммичены (ef5b165); контракт _common.md добавил бы форму отчёта, но не изменил бы результат. Цена ошибки: низкая — граница задачи в один скрипт, регресс виден первым же прогоном pretest. Роли зарегистрированы в текущей сессии, дальнейшие задачи диспатчатся штатно.
   concern (task 011): review split: 2 finding(s) came from a minority of 3 polls — the others approved
 Task 011: complete (8f784135283022cccfc9ed2d19b8151bd36fd1e0)
+  concern (task 012): declared-files hint mismatch (non-blocking, initial): missing-declared: services/backend/tests/courses.test.ts, services/backend/tests/progress.test.ts, services/backend/tests/sandbox.test.ts, services/backend/tests/transfer.test.ts
+Task 012: complete (0f47e8d6574564e44f4f977b8da54d863cc2e94c)
diff --git a/package-lock.json b/package-lock.json
index 72f6a4b..afb2014 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1155,6 +1155,15 @@
         "assertion-error": "^2.0.1"
       }
     },
+    "node_modules/@types/debug": {
+      "version": "4.1.13",
+      "resolved": "https://registry.npmjs.org/@types/debug/-/debug-4.1.13.tgz",
+      "integrity": "sha512-KSVgmQmzMwPlmtljOomayoR89W4FynCAi3E8PPs7vmDVPe84hT+vGPKkJfThkmXs0x0jAaa9U8uW8bbfyS2fWw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/ms": "*"
+      }
+    },
     "node_modules/@types/deep-eql": {
       "version": "4.0.2",
       "resolved": "https://registry.npmjs.org/@types/deep-eql/-/deep-eql-4.0.2.tgz",
@@ -1173,9 +1182,26 @@
       "version": "1.0.9",
       "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
       "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
-      "dev": true,
       "license": "MIT"
     },
+    "node_modules/@types/estree-jsx": {
+      "version": "1.0.5",
+      "resolved": "https://registry.npmjs.org/@types/estree-jsx/-/estree-jsx-1.0.5.tgz",
+      "integrity": "sha512-52CcUVNFyfb1A2ALocQw/Dd1BQFNmSdkuC3BkZ6iqhdMfQz7JWOFRuJFloOzjk+6WijU56m9oKXFAXc7o3Towg==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/estree": "*"
+      }
+    },
+    "node_modules/@types/hast": {
+      "version": "3.0.5",
+      "resolved": "https://registry.npmjs.org/@types/hast/-/hast-3.0.5.tgz",
+      "integrity": "sha512-rp/ezSWaD1m44dPKICGhiskI13nVr7qTloFwDa/IYkhhf5nzwP+zIQcIJh3WIFSBOy/H1PzB40jPjMDksN4F+g==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "*"
+      }
+    },
     "node_modules/@types/json-schema": {
       "version": "7.0.15",
       "resolved": "https://registry.npmjs.org/@types/json-schema/-/json-schema-7.0.15.tgz",
@@ -1183,6 +1209,21 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/@types/mdast": {
+      "version": "4.0.4",
+      "resolved": "https://registry.npmjs.org/@types/mdast/-/mdast-4.0.4.tgz",
+      "integrity": "sha512-kGaNbPh1k7AFzgpud/gMdvIm5xuECykRR+JnWKQno9TAXVa6WIVCGTPvYGekIDL4uwCZQSYbUxNBSb1aUo79oA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "*"
+      }
+    },
+    "node_modules/@types/ms": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/@types/ms/-/ms-2.1.0.tgz",
+      "integrity": "sha512-GsCCIZDE/p3i96vtEqx+7dBUGXrc7zeSK3wwPHIaRThS+9OhWIXRqzs4d6k1SVU8g91DrNRWxWUGhp5KXQb2VA==",
+      "license": "MIT"
+    },
     "node_modules/@types/node": {
       "version": "22.20.3",
       "resolved": "https://registry.npmjs.org/@types/node/-/node-22.20.3.tgz",
@@ -1209,7 +1250,6 @@
       "version": "19.3.0",
       "resolved": "https://registry.npmjs.org/@types/react/-/react-19.3.0.tgz",
       "integrity": "sha512-N0rFCuH9YoxG9/m61l9MfpJKfmLOVU0em7ipIz6TRgSSkvReLB9vL85GB+yr8Bs5leqpvg96JSwF4ZS1s4viQg==",
-      "dev": true,
       "license": "MIT",
       "dependencies": {
         "csstype": "^3.2.2"
@@ -1225,6 +1265,12 @@
         "@types/react": "^19.3.0"
       }
     },
+    "node_modules/@types/unist": {
+      "version": "3.0.3",
+      "resolved": "https://registry.npmjs.org/@types/unist/-/unist-3.0.3.tgz",
+      "integrity": "sha512-ko/gIFJRv177XgZsZcBwnqJN5x/Gien8qNOn0D5bQU/zAzVf9Zt3BlcUiLqhV9y4ARk0GbT3tnUiPNgnTXzc/Q==",
+      "license": "MIT"
+    },
     "node_modules/@typescript-eslint/eslint-plugin": {
       "version": "8.70.0",
       "resolved": "https://registry.npmjs.org/@typescript-eslint/eslint-plugin/-/eslint-plugin-8.70.0.tgz",
@@ -1455,6 +1501,12 @@
         "url": "https://opencollective.com/typescript-eslint"
       }
     },
+    "node_modules/@ungap/structured-clone": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/@ungap/structured-clone/-/structured-clone-1.4.0.tgz",
+      "integrity": "sha512-1mEZtMKPM09vDmQt5y7YvmN2+DFTP7Tg0EWXdic8/C6VRnpb33e4ghisCIE3WZjsE2N8mf+QV1Zqh7ZFYLWInQ==",
+      "license": "ISC"
+    },
     "node_modules/@vitejs/plugin-react": {
       "version": "6.1.1",
       "resolved": "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-6.1.1.tgz",
@@ -1699,6 +1751,16 @@
         "fastq": "^1.17.1"
       }
     },
+    "node_modules/bail": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/bail/-/bail-2.0.2.tgz",
+      "integrity": "sha512-0xO6mYd7JB2YesxDKplafRpsiOzPt9V02ddPCLbY1xYGPOX24NTyN50qnUxgCPcSoYMhKpAuBTjQoRZCAkUDRw==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/balanced-match": {
       "version": "4.0.4",
       "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-4.0.4.tgz",
@@ -1746,6 +1808,16 @@
         "qified": "^0.10.1"
       }
     },
+    "node_modules/ccount": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/ccount/-/ccount-2.0.1.tgz",
+      "integrity": "sha512-eyrF0jiFpY+3drT6383f1qhkbGsLSifNAjA61IUjZjmLCWjItY6LB9ft9YhoDgwfmclB2zhu51Lc7+95b8NRAg==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/chai": {
       "version": "6.2.2",
       "resolved": "https://registry.npmjs.org/chai/-/chai-6.2.2.tgz",
@@ -1756,6 +1828,56 @@
         "node": ">=18"
       }
     },
+    "node_modules/character-entities": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/character-entities/-/character-entities-2.0.2.tgz",
+      "integrity": "sha512-shx7oQ0Awen/BRIdkjkvz54PnEEI/EjwXDSIZp86/KKdbafHh1Df/RYGBhn4hbe2+uKC9FnT5UCEdyPz3ai9hQ==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/character-entities-html4": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/character-entities-html4/-/character-entities-html4-2.1.0.tgz",
+      "integrity": "sha512-1v7fgQRj6hnSwFpq1Eu0ynr/CDEw0rXo2B61qXrLNdHZmPKgb7fqS1a2JwF0rISo9q77jDI8VMEHoApn8qDoZA==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/character-entities-legacy": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/character-entities-legacy/-/character-entities-legacy-3.0.0.tgz",
+      "integrity": "sha512-RpPp0asT/6ufRm//AJVwpViZbGM/MkjQFxJccQRHmISF/22NBtsHqAWmL+/pmkPWoIUJdWyeVleTl1wydHATVQ==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/character-reference-invalid": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/character-reference-invalid/-/character-reference-invalid-2.0.1.tgz",
+      "integrity": "sha512-iBZ4F4wRbyORVsu0jPV7gXkOsGYjGHPmAyv+HiHG8gi5PtC9KI2j1+v8/tlibRvjoWX027ypmG/n0HtO5t7unw==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/comma-separated-tokens": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/comma-separated-tokens/-/comma-separated-tokens-2.0.3.tgz",
+      "integrity": "sha512-Fu4hJdvzeylCfQPp9SGWidpzrMs7tTrlu6Vb8XGaRGck8QSNZJJp538Wrb60Lax4fPwR64ViY468OIUTbRlGZg==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/cookie": {
       "version": "1.1.1",
       "resolved": "https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz",
@@ -1808,7 +1930,6 @@
       "version": "3.2.3",
       "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.2.3.tgz",
       "integrity": "sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ==",
-      "dev": true,
       "license": "MIT"
     },
     "node_modules/data-urls": {
@@ -1844,7 +1965,6 @@
       "version": "4.4.3",
       "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
       "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
-      "dev": true,
       "license": "MIT",
       "dependencies": {
         "ms": "^2.1.3"
@@ -1865,6 +1985,19 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/decode-named-character-reference": {
+      "version": "1.3.0",
+      "resolved": "https://registry.npmjs.org/decode-named-character-reference/-/decode-named-character-reference-1.3.0.tgz",
+      "integrity": "sha512-GtpQYB283KrPp6nRw50q3U9/VfOutZOe103qlN7BPP6Ad27xYnOIWv4lPzo8HCAL+mMZofJ9KEy30fq6MfaK6Q==",
+      "license": "MIT",
+      "dependencies": {
+        "character-entities": "^2.0.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/deep-is": {
       "version": "0.1.4",
       "resolved": "https://registry.npmjs.org/deep-is/-/deep-is-0.1.4.tgz",
@@ -1891,6 +2024,19 @@
         "node": ">=8"
       }
     },
+    "node_modules/devlop": {
+      "version": "1.1.0",
+      "resolved": "https://registry.npmjs.org/devlop/-/devlop-1.1.0.tgz",
+      "integrity": "sha512-RWmIqhcFf1lRYBvNmr7qTNuyCt/7/ns2jbpp1+PalgE/rDQcBT0fioSMUpJ93irlUhC5hrg4cYqe6U+0ImW0rA==",
+      "license": "MIT",
+      "dependencies": {
+        "dequal": "^2.0.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/dom-accessibility-api": {
       "version": "0.5.16",
       "resolved": "https://registry.npmjs.org/dom-accessibility-api/-/dom-accessibility-api-0.5.16.tgz",
@@ -2077,6 +2223,16 @@
         "node": ">=4.0"
       }
     },
+    "node_modules/estree-util-is-identifier-name": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/estree-util-is-identifier-name/-/estree-util-is-identifier-name-3.0.0.tgz",
+      "integrity": "sha512-hFtqIDZTIUZ9BXLb8y4pYGyk6+wekIivNVTcmvk8NoOh+VeRn5y6cEHzbURrWbfp1fIqdVipilzj+lfaadNZmg==",
+      "license": "MIT",
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/estree-walker": {
       "version": "3.0.3",
       "resolved": "https://registry.npmjs.org/estree-walker/-/estree-walker-3.0.3.tgz",
@@ -2107,6 +2263,12 @@
         "node": ">=12.0.0"
       }
     },
+    "node_modules/extend": {
+      "version": "3.0.2",
+      "resolved": "https://registry.npmjs.org/extend/-/extend-3.0.2.tgz",
+      "integrity": "sha512-fjquC59cD7CyW6urNXK0FBufkZcoiGG80wTuPujX590cB5Ttln20E2UB4S/WARVqhXffZl2LNgS+gQdPIIim/g==",
+      "license": "MIT"
+    },
     "node_modules/fast-decode-uri-component": {
       "version": "1.0.1",
       "resolved": "https://registry.npmjs.org/fast-decode-uri-component/-/fast-decode-uri-component-1.0.1.tgz",
@@ -2381,6 +2543,46 @@
         "node": ">=20"
       }
     },
+    "node_modules/hast-util-to-jsx-runtime": {
+      "version": "2.3.6",
+      "resolved": "https://registry.npmjs.org/hast-util-to-jsx-runtime/-/hast-util-to-jsx-runtime-2.3.6.tgz",
+      "integrity": "sha512-zl6s8LwNyo1P9uw+XJGvZtdFF1GdAkOg8ujOw+4Pyb76874fLps4ueHXDhXWdk6YHQ6OgUtinliG7RsYvCbbBg==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/estree": "^1.0.0",
+        "@types/hast": "^3.0.0",
+        "@types/unist": "^3.0.0",
+        "comma-separated-tokens": "^2.0.0",
+        "devlop": "^1.0.0",
+        "estree-util-is-identifier-name": "^3.0.0",
+        "hast-util-whitespace": "^3.0.0",
+        "mdast-util-mdx-expression": "^2.0.0",
+        "mdast-util-mdx-jsx": "^3.0.0",
+        "mdast-util-mdxjs-esm": "^2.0.0",
+        "property-information": "^7.0.0",
+        "space-separated-tokens": "^2.0.0",
+        "style-to-js": "^1.0.0",
+        "unist-util-position": "^5.0.0",
+        "vfile-message": "^4.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/hast-util-whitespace": {
+      "version": "3.0.0",
+      "resolved": "https://registry.npmjs.org/hast-util-whitespace/-/hast-util-whitespace-3.0.0.tgz",
+      "integrity": "sha512-88JUN06ipLwsnv+dVn+OIYOvAuvBMy/Qoi6O7mQHxdPXpjy+Cd6xRkWwux7DKO+4sYILtLBRIKgsdpS2gQc7qw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/hast": "^3.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/hookified": {
       "version": "1.15.1",
       "resolved": "https://registry.npmjs.org/hookified/-/hookified-1.15.1.tgz",
@@ -2401,6 +2603,16 @@
         "node": "^20.19.0 || ^22.12.0 || >=24.0.0"
       }
     },
+    "node_modules/html-url-attributes": {
+      "version": "3.0.1",
+      "resolved": "https://registry.npmjs.org/html-url-attributes/-/html-url-attributes-3.0.1.tgz",
+      "integrity": "sha512-ol6UPyBWqsrO6EJySPz2O7ZSr856WDrEzM5zMqp+FJJLGMW35cLYmmZnl0vztAZxRUoNZJFTCohfjuIJ8I4QBQ==",
+      "license": "MIT",
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/ignore": {
       "version": "5.3.2",
       "resolved": "https://registry.npmjs.org/ignore/-/ignore-5.3.2.tgz",
@@ -2421,6 +2633,12 @@
         "node": ">=0.8.19"
       }
     },
+    "node_modules/inline-style-parser": {
+      "version": "0.2.7",
+      "resolved": "https://registry.npmjs.org/inline-style-parser/-/inline-style-parser-0.2.7.tgz",
+      "integrity": "sha512-Nb2ctOyNR8DqQoR0OwRG95uNWIC0C1lCgf5Naz5H6Ji72KZ8OcFZLz2P5sNgwlyoJ8Yif11oMuYs5pBQa86csA==",
+      "license": "MIT"
+    },
     "node_modules/ipaddr.js": {
       "version": "2.5.0",
       "resolved": "https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-2.5.0.tgz",
@@ -2430,6 +2648,40 @@
         "node": ">= 10"
       }
     },
+    "node_modules/is-alphabetical": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/is-alphabetical/-/is-alphabetical-2.0.1.tgz",
+      "integrity": "sha512-FWyyY60MeTNyeSRpkM2Iry0G9hpr7/9kD40mD/cGQEuilcZYS4okz8SN2Q6rLCJ8gbCt6fN+rC+6tMGS99LaxQ==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/is-alphanumerical": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/is-alphanumerical/-/is-alphanumerical-2.0.1.tgz",
+      "integrity": "sha512-hmbYhX/9MUMF5uh7tOXyK/n0ZvWpad5caBA17GsC6vyuCqaWliRG5K1qS9inmUhEMaOBIW7/whAnSwveW/LtZw==",
+      "license": "MIT",
+      "dependencies": {
+        "is-alphabetical": "^2.0.0",
+        "is-decimal": "^2.0.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/is-decimal": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/is-decimal/-/is-decimal-2.0.1.tgz",
+      "integrity": "sha512-AAB9hiomQs5DXWcRB1rqsxGUstbRroFOPPVAomNk/3XHR5JyEZChOyTWe2oayKnsSsr/kcGqF+z6yuH6HHpN0A==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/is-extglob": {
       "version": "2.1.1",
       "resolved": "https://registry.npmjs.org/is-extglob/-/is-extglob-2.1.1.tgz",
@@ -2453,6 +2705,28 @@
         "node": ">=0.10.0"
       }
     },
+    "node_modules/is-hexadecimal": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/is-hexadecimal/-/is-hexadecimal-2.0.1.tgz",
+      "integrity": "sha512-DgZQp241c8oO6cA1SbTEWiXeoxV42vlcJxgH+B3hi1AiqqKruZR3ZGF8In3fj4+/y/7rHvlOZLZtgJ/4ttYGZg==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/is-plain-obj": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/is-plain-obj/-/is-plain-obj-4.1.0.tgz",
+      "integrity": "sha512-+Pgi+vMuUNkJyExiMBt5IlFoMyKnr5zhJ4Uspz58WOhBF5QoIZkFyNHIbBAtHwzVAgk5RtndVNsDRN61/mmDqg==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=12"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/sindresorhus"
+      }
+    },
     "node_modules/is-potential-custom-element-name": {
       "version": "1.0.1",
       "resolved": "https://registry.npmjs.org/is-potential-custom-element-name/-/is-potential-custom-element-name-1.0.1.tgz",
@@ -2896,6 +3170,16 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/longest-streak": {
+      "version": "3.1.0",
+      "resolved": "https://registry.npmjs.org/longest-streak/-/longest-streak-3.1.0.tgz",
+      "integrity": "sha512-9Ri+o0JYgehTaVBBDoMqIl8GXtbWg711O3srftcHhZ0dqnETqLaoIK0x17fUw9rFSlK/0NlsKe0Ahhyl5pXE2g==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/lru-cache": {
       "version": "11.5.2",
       "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-11.5.2.tgz",
@@ -2927,100 +3211,694 @@
         "@jridgewell/sourcemap-codec": "^1.6.0"
       }
     },
-    "node_modules/mdn-data": {
-      "version": "2.27.1",
-      "resolved": "https://registry.npmjs.org/mdn-data/-/mdn-data-2.27.1.tgz",
-      "integrity": "sha512-9Yubnt3e8A0OKwxYSXyhLymGW4sCufcLG6VdiDdUGVkPhpqLxlvP5vl1983gQjJl3tqbrM731mjaZaP68AgosQ==",
-      "dev": true,
-      "license": "CC0-1.0"
-    },
-    "node_modules/minimatch": {
-      "version": "10.2.6",
-      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz",
-      "integrity": "sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==",
-      "dev": true,
-      "license": "BlueOak-1.0.0",
+    "node_modules/mdast-util-from-markdown": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/mdast-util-from-markdown/-/mdast-util-from-markdown-2.0.3.tgz",
+      "integrity": "sha512-W4mAWTvSlKvf8L6J+VN9yLSqQ9AOAAvHuoDAmPkz4dHf553m5gVj2ejadHJhoJmcmxEnOv6Pa8XJhpxE93kb8Q==",
+      "license": "MIT",
       "dependencies": {
-        "brace-expansion": "^5.0.8"
-      },
-      "engines": {
-        "node": "18 || 20 || >=22"
+        "@types/mdast": "^4.0.0",
+        "@types/unist": "^3.0.0",
+        "decode-named-character-reference": "^1.0.0",
+        "devlop": "^1.0.0",
+        "mdast-util-to-string": "^4.0.0",
+        "micromark": "^4.0.0",
+        "micromark-util-decode-numeric-character-reference": "^2.0.0",
+        "micromark-util-decode-string": "^2.0.0",
+        "micromark-util-normalize-identifier": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0",
+        "unist-util-stringify-position": "^4.0.0"
       },
       "funding": {
-        "url": "https://github.com/sponsors/isaacs"
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
       }
     },
-    "node_modules/ms": {
-      "version": "2.1.3",
-      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
-      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
-      "dev": true,
-      "license": "MIT"
-    },
-    "node_modules/nanoid": {
-      "version": "3.3.19",
-      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.19.tgz",
-      "integrity": "sha512-Y2tUNy4ouw6tq5oDSKeQYGOyhkUBhNOcGV/02KC+6kd9eDGqdZd++mjMiIDilrBYvjEnCYvVtsuHCuP+okSfug==",
-      "dev": true,
-      "funding": [
-        {
-          "type": "github",
-          "url": "https://github.com/sponsors/ai"
-        }
-      ],
+    "node_modules/mdast-util-mdx-expression": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/mdast-util-mdx-expression/-/mdast-util-mdx-expression-2.0.1.tgz",
+      "integrity": "sha512-J6f+9hUp+ldTZqKRSg7Vw5V6MqjATc+3E4gf3CFNcuZNWD8XdyI6zQ8GqH7f8169MM6P7hMBRDVGnn7oHB9kXQ==",
       "license": "MIT",
-      "bin": {
-        "nanoid": "bin/nanoid.cjs"
+      "dependencies": {
+        "@types/estree-jsx": "^1.0.0",
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "devlop": "^1.0.0",
+        "mdast-util-from-markdown": "^2.0.0",
+        "mdast-util-to-markdown": "^2.0.0"
       },
-      "engines": {
-        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
       }
     },
-    "node_modules/natural-compare": {
-      "version": "1.4.0",
-      "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
-      "integrity": "sha512-OWND8ei3VtNC9h7V60qff3SVobHr996CTwgxubgyQYEpg290h9J0buyECNNJexkFm5sOajh5G116RYA1c8ZMSw==",
-      "dev": true,
-      "license": "MIT"
-    },
-    "node_modules/obug": {
-      "version": "2.2.1",
-      "resolved": "https://registry.npmjs.org/obug/-/obug-2.2.1.tgz",
-      "integrity": "sha512-XrsrhT5sybtKI6wakr2SPOlGZWWYbUXZ7a0jT8/QOeAPau+1X/bSegNe5YR75oJmEZQbKningirmGOEJCIk61Q==",
-      "dev": true,
-      "funding": [
-        "https://github.com/sponsors/sxzz",
-        "https://opencollective.com/debug"
-      ],
+    "node_modules/mdast-util-mdx-jsx": {
+      "version": "3.2.0",
+      "resolved": "https://registry.npmjs.org/mdast-util-mdx-jsx/-/mdast-util-mdx-jsx-3.2.0.tgz",
+      "integrity": "sha512-lj/z8v0r6ZtsN/cGNNtemmmfoLAFZnjMbNyLzBafjzikOM+glrjNHPlf6lQDOTccj9n5b0PPihEBbhneMyGs1Q==",
       "license": "MIT",
-      "engines": {
-        "node": ">=12.20.0"
+      "dependencies": {
+        "@types/estree-jsx": "^1.0.0",
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "@types/unist": "^3.0.0",
+        "ccount": "^2.0.0",
+        "devlop": "^1.1.0",
+        "mdast-util-from-markdown": "^2.0.0",
+        "mdast-util-to-markdown": "^2.0.0",
+        "parse-entities": "^4.0.0",
+        "stringify-entities": "^4.0.0",
+        "unist-util-stringify-position": "^4.0.0",
+        "vfile-message": "^4.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
       }
     },
-    "node_modules/on-exit-leak-free": {
-      "version": "2.1.2",
-      "resolved": "https://registry.npmjs.org/on-exit-leak-free/-/on-exit-leak-free-2.1.2.tgz",
-      "integrity": "sha512-0eJJY6hXLGf1udHwfNftBqH+g73EU4B504nZeKpz1sYRKafAghwxEJunB2O7rDZkL4PGfsMVnTXZ2EjibbqcsA==",
+    "node_modules/mdast-util-mdxjs-esm": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/mdast-util-mdxjs-esm/-/mdast-util-mdxjs-esm-2.0.1.tgz",
+      "integrity": "sha512-EcmOpxsZ96CvlP03NghtH1EsLtr0n9Tm4lPUJUBccV9RwUOneqSycg19n5HGzCf+10LozMRSObtVr3ee1WoHtg==",
       "license": "MIT",
-      "engines": {
-        "node": ">=14.0.0"
+      "dependencies": {
+        "@types/estree-jsx": "^1.0.0",
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "devlop": "^1.0.0",
+        "mdast-util-from-markdown": "^2.0.0",
+        "mdast-util-to-markdown": "^2.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
       }
     },
-    "node_modules/optionator": {
-      "version": "0.9.4",
-      "resolved": "https://registry.npmjs.org/optionator/-/optionator-0.9.4.tgz",
-      "integrity": "sha512-6IpQ7mKUxRcZNLIObR0hz7lxsapSSIYNZJwXPGeF0mTVqGKFIXj1DQcMoT22S3ROcLyY/rz0PWaWZ9ayWmad9g==",
-      "dev": true,
+    "node_modules/mdast-util-phrasing": {
+      "version": "4.1.0",
+      "resolved": "https://registry.npmjs.org/mdast-util-phrasing/-/mdast-util-phrasing-4.1.0.tgz",
+      "integrity": "sha512-TqICwyvJJpBwvGAMZjj4J2n0X8QWp21b9l0o7eXyVJ25YNWYbJDVIyD1bZXE6WtV6RmKJVYmQAKWa0zWOABz2w==",
       "license": "MIT",
       "dependencies": {
-        "deep-is": "^0.1.3",
-        "fast-levenshtein": "^2.0.6",
-        "levn": "^0.4.1",
-        "prelude-ls": "^1.2.1",
-        "type-check": "^0.4.0",
-        "word-wrap": "^1.2.5"
+        "@types/mdast": "^4.0.0",
+        "unist-util-is": "^6.0.0"
       },
-      "engines": {
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/mdast-util-to-hast": {
+      "version": "13.2.1",
+      "resolved": "https://registry.npmjs.org/mdast-util-to-hast/-/mdast-util-to-hast-13.2.1.tgz",
+      "integrity": "sha512-cctsq2wp5vTsLIcaymblUriiTcZd0CwWtCbLvrOzYCDZoWyMNV8sZ7krj09FSnsiJi3WVsHLM4k6Dq/yaPyCXA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "@ungap/structured-clone": "^1.0.0",
+        "devlop": "^1.0.0",
+        "micromark-util-sanitize-uri": "^2.0.0",
+        "trim-lines": "^3.0.0",
+        "unist-util-position": "^5.0.0",
+        "unist-util-visit": "^5.0.0",
+        "vfile": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/mdast-util-to-markdown": {
+      "version": "2.1.2",
+      "resolved": "https://registry.npmjs.org/mdast-util-to-markdown/-/mdast-util-to-markdown-2.1.2.tgz",
+      "integrity": "sha512-xj68wMTvGXVOKonmog6LwyJKrYXZPvlwabaryTjLh9LuvovB/KAH+kvi8Gjj+7rJjsFi23nkUxRQv1KqSroMqA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/mdast": "^4.0.0",
+        "@types/unist": "^3.0.0",
+        "longest-streak": "^3.0.0",
+        "mdast-util-phrasing": "^4.0.0",
+        "mdast-util-to-string": "^4.0.0",
+        "micromark-util-classify-character": "^2.0.0",
+        "micromark-util-decode-string": "^2.0.0",
+        "unist-util-visit": "^5.0.0",
+        "zwitch": "^2.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/mdast-util-to-string": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/mdast-util-to-string/-/mdast-util-to-string-4.0.0.tgz",
+      "integrity": "sha512-0H44vDimn51F0YwvxSJSm0eCDOJTRlmN0R1yBh4HLj9wiV1Dn0QoXGbvFAWj2hSItVTlCmBF1hqKlIyUBVFLPg==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/mdast": "^4.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/mdn-data": {
+      "version": "2.27.1",
+      "resolved": "https://registry.npmjs.org/mdn-data/-/mdn-data-2.27.1.tgz",
+      "integrity": "sha512-9Yubnt3e8A0OKwxYSXyhLymGW4sCufcLG6VdiDdUGVkPhpqLxlvP5vl1983gQjJl3tqbrM731mjaZaP68AgosQ==",
+      "dev": true,
+      "license": "CC0-1.0"
+    },
+    "node_modules/micromark": {
+      "version": "4.0.2",
+      "resolved": "https://registry.npmjs.org/micromark/-/micromark-4.0.2.tgz",
+      "integrity": "sha512-zpe98Q6kvavpCr1NPVSCMebCKfD7CA2NqZ+rykeNhONIJBpc1tFKt9hucLGwha3jNTNI8lHpctWJWoimVF4PfA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "@types/debug": "^4.0.0",
+        "debug": "^4.0.0",
+        "decode-named-character-reference": "^1.0.0",
+        "devlop": "^1.0.0",
+        "micromark-core-commonmark": "^2.0.0",
+        "micromark-factory-space": "^2.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-chunked": "^2.0.0",
+        "micromark-util-combine-extensions": "^2.0.0",
+        "micromark-util-decode-numeric-character-reference": "^2.0.0",
+        "micromark-util-encode": "^2.0.0",
+        "micromark-util-normalize-identifier": "^2.0.0",
+        "micromark-util-resolve-all": "^2.0.0",
+        "micromark-util-sanitize-uri": "^2.0.0",
+        "micromark-util-subtokenize": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-core-commonmark": {
+      "version": "2.0.3",
+      "resolved": "https://registry.npmjs.org/micromark-core-commonmark/-/micromark-core-commonmark-2.0.3.tgz",
+      "integrity": "sha512-RDBrHEMSxVFLg6xvnXmb1Ayr2WzLAWjeSATAoxwKYJV94TeNavgoIdA0a9ytzDSVzBy2YKFK+emCPOEibLeCrg==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "decode-named-character-reference": "^1.0.0",
+        "devlop": "^1.0.0",
+        "micromark-factory-destination": "^2.0.0",
+        "micromark-factory-label": "^2.0.0",
+        "micromark-factory-space": "^2.0.0",
+        "micromark-factory-title": "^2.0.0",
+        "micromark-factory-whitespace": "^2.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-chunked": "^2.0.0",
+        "micromark-util-classify-character": "^2.0.0",
+        "micromark-util-html-tag-name": "^2.0.0",
+        "micromark-util-normalize-identifier": "^2.0.0",
+        "micromark-util-resolve-all": "^2.0.0",
+        "micromark-util-subtokenize": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-factory-destination": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-factory-destination/-/micromark-factory-destination-2.0.1.tgz",
+      "integrity": "sha512-Xe6rDdJlkmbFRExpTOmRj9N3MaWmbAgdpSrBQvCFqhezUn4AHqJHbaEnfbVYYiexVSs//tqOdY/DxhjdCiJnIA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-factory-label": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-factory-label/-/micromark-factory-label-2.0.1.tgz",
+      "integrity": "sha512-VFMekyQExqIW7xIChcXn4ok29YE3rnuyveW3wZQWWqF4Nv9Wk5rgJ99KzPvHjkmPXF93FXIbBp6YdW3t71/7Vg==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "devlop": "^1.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-factory-space": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-factory-space/-/micromark-factory-space-2.0.1.tgz",
+      "integrity": "sha512-zRkxjtBxxLd2Sc0d+fbnEunsTj46SWXgXciZmHq0kDYGnck/ZSGj9/wULTV95uoeYiK5hRXP2mJ98Uo4cq/LQg==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-factory-title": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-factory-title/-/micromark-factory-title-2.0.1.tgz",
+      "integrity": "sha512-5bZ+3CjhAd9eChYTHsjy6TGxpOFSKgKKJPJxr293jTbfry2KDoWkhBb6TcPVB4NmzaPhMs1Frm9AZH7OD4Cjzw==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-factory-space": "^2.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-factory-whitespace": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-factory-whitespace/-/micromark-factory-whitespace-2.0.1.tgz",
+      "integrity": "sha512-Ob0nuZ3PKt/n0hORHyvoD9uZhr+Za8sFoP+OnMcnWK5lngSzALgQYKMr9RJVOWLqQYuyn6ulqGWSXdwf6F80lQ==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-factory-space": "^2.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-character": {
+      "version": "2.1.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-character/-/micromark-util-character-2.1.1.tgz",
+      "integrity": "sha512-wv8tdUTJ3thSFFFJKtpYKOYiGP2+v96Hvk4Tu8KpCAsTMs6yi+nVmGh1syvSCsaxz45J6Jbw+9DD6g97+NV67Q==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-chunked": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-chunked/-/micromark-util-chunked-2.0.1.tgz",
+      "integrity": "sha512-QUNFEOPELfmvv+4xiNg2sRYeS/P84pTW0TCgP5zc9FpXetHY0ab7SxKyAQCNCc1eK0459uoLI1y5oO5Vc1dbhA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-symbol": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-classify-character": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-classify-character/-/micromark-util-classify-character-2.0.1.tgz",
+      "integrity": "sha512-K0kHzM6afW/MbeWYWLjoHQv1sgg2Q9EccHEDzSkxiP/EaagNzCm7T/WMKZ3rjMbvIpvBiZgwR3dKMygtA4mG1Q==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-combine-extensions": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-combine-extensions/-/micromark-util-combine-extensions-2.0.1.tgz",
+      "integrity": "sha512-OnAnH8Ujmy59JcyZw8JSbK9cGpdVY44NKgSM7E9Eh7DiLS2E9RNQf0dONaGDzEG9yjEl5hcqeIsj4hfRkLH/Bg==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-chunked": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-decode-numeric-character-reference": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/micromark-util-decode-numeric-character-reference/-/micromark-util-decode-numeric-character-reference-2.0.2.tgz",
+      "integrity": "sha512-ccUbYk6CwVdkmCQMyr64dXz42EfHGkPQlBj5p7YVGzq8I7CtjXZJrubAYezf7Rp+bjPseiROqe7G6foFd+lEuw==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-symbol": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-decode-string": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-decode-string/-/micromark-util-decode-string-2.0.1.tgz",
+      "integrity": "sha512-nDV/77Fj6eH1ynwscYTOsbK7rR//Uj0bZXBwJZRfaLEJ1iGBR6kIfNmlNqaqJf649EP0F3NWNdeJi03elllNUQ==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "decode-named-character-reference": "^1.0.0",
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-decode-numeric-character-reference": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-encode": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-encode/-/micromark-util-encode-2.0.1.tgz",
+      "integrity": "sha512-c3cVx2y4KqUnwopcO9b/SCdo2O67LwJJ/UyqGfbigahfegL9myoEFoDYZgkT7f36T0bLrM9hZTAaAyH+PCAXjw==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT"
+    },
+    "node_modules/micromark-util-html-tag-name": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-html-tag-name/-/micromark-util-html-tag-name-2.0.1.tgz",
+      "integrity": "sha512-2cNEiYDhCWKI+Gs9T0Tiysk136SnR13hhO8yW6BGNyhOC4qYFnwF1nKfD3HFAIXA5c45RrIG1ub11GiXeYd1xA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT"
+    },
+    "node_modules/micromark-util-normalize-identifier": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-normalize-identifier/-/micromark-util-normalize-identifier-2.0.1.tgz",
+      "integrity": "sha512-sxPqmo70LyARJs0w2UclACPUUEqltCkJ6PhKdMIDuJ3gSf/Q+/GIe3WKl0Ijb/GyH9lOpUkRAO2wp0GVkLvS9Q==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-symbol": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-resolve-all": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-resolve-all/-/micromark-util-resolve-all-2.0.1.tgz",
+      "integrity": "sha512-VdQyxFWFT2/FGJgwQnJYbe1jjQoNTS4RjglmSjTUlpUMa95Htx9NHeYW4rGDJzbjvCsl9eLjMQwGeElsqmzcHg==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-sanitize-uri": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-sanitize-uri/-/micromark-util-sanitize-uri-2.0.1.tgz",
+      "integrity": "sha512-9N9IomZ/YuGGZZmQec1MbgxtlgougxTodVwDzzEouPKo3qFWvymFHWcnDi2vzV1ff6kas9ucW+o3yzJK9YB1AQ==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "micromark-util-character": "^2.0.0",
+        "micromark-util-encode": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-subtokenize": {
+      "version": "2.1.0",
+      "resolved": "https://registry.npmjs.org/micromark-util-subtokenize/-/micromark-util-subtokenize-2.1.0.tgz",
+      "integrity": "sha512-XQLu552iSctvnEcgXw6+Sx75GflAPNED1qx7eBJ+wydBb2KCbRZe+NwvIEEMM83uml1+2WSXpBAcp9IUCgCYWA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT",
+      "dependencies": {
+        "devlop": "^1.0.0",
+        "micromark-util-chunked": "^2.0.0",
+        "micromark-util-symbol": "^2.0.0",
+        "micromark-util-types": "^2.0.0"
+      }
+    },
+    "node_modules/micromark-util-symbol": {
+      "version": "2.0.1",
+      "resolved": "https://registry.npmjs.org/micromark-util-symbol/-/micromark-util-symbol-2.0.1.tgz",
+      "integrity": "sha512-vs5t8Apaud9N28kgCrRUdEed4UJ+wWNvicHLPxCa9ENlYuAY31M0ETy5y1vA33YoNPDFTghEbnh6efaE8h4x0Q==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT"
+    },
+    "node_modules/micromark-util-types": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/micromark-util-types/-/micromark-util-types-2.0.2.tgz",
+      "integrity": "sha512-Yw0ECSpJoViF1qTU4DC6NwtC4aWGt1EkzaQB8KPPyCRR8z9TWeV0HbEFGTO+ZY1wB22zmxnJqhPyTpOVCpeHTA==",
+      "funding": [
+        {
+          "type": "GitHub Sponsors",
+          "url": "https://github.com/sponsors/unifiedjs"
+        },
+        {
+          "type": "OpenCollective",
+          "url": "https://opencollective.com/unified"
+        }
+      ],
+      "license": "MIT"
+    },
+    "node_modules/minimatch": {
+      "version": "10.2.6",
+      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz",
+      "integrity": "sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A==",
+      "dev": true,
+      "license": "BlueOak-1.0.0",
+      "dependencies": {
+        "brace-expansion": "^5.0.8"
+      },
+      "engines": {
+        "node": "18 || 20 || >=22"
+      },
+      "funding": {
+        "url": "https://github.com/sponsors/isaacs"
+      }
+    },
+    "node_modules/ms": {
+      "version": "2.1.3",
+      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
+      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
+      "license": "MIT"
+    },
+    "node_modules/nanoid": {
+      "version": "3.3.19",
+      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.19.tgz",
+      "integrity": "sha512-Y2tUNy4ouw6tq5oDSKeQYGOyhkUBhNOcGV/02KC+6kd9eDGqdZd++mjMiIDilrBYvjEnCYvVtsuHCuP+okSfug==",
+      "dev": true,
+      "funding": [
+        {
+          "type": "github",
+          "url": "https://github.com/sponsors/ai"
+        }
+      ],
+      "license": "MIT",
+      "bin": {
+        "nanoid": "bin/nanoid.cjs"
+      },
+      "engines": {
+        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
+      }
+    },
+    "node_modules/natural-compare": {
+      "version": "1.4.0",
+      "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
+      "integrity": "sha512-OWND8ei3VtNC9h7V60qff3SVobHr996CTwgxubgyQYEpg290h9J0buyECNNJexkFm5sOajh5G116RYA1c8ZMSw==",
+      "dev": true,
+      "license": "MIT"
+    },
+    "node_modules/obug": {
+      "version": "2.2.1",
+      "resolved": "https://registry.npmjs.org/obug/-/obug-2.2.1.tgz",
+      "integrity": "sha512-XrsrhT5sybtKI6wakr2SPOlGZWWYbUXZ7a0jT8/QOeAPau+1X/bSegNe5YR75oJmEZQbKningirmGOEJCIk61Q==",
+      "dev": true,
+      "funding": [
+        "https://github.com/sponsors/sxzz",
+        "https://opencollective.com/debug"
+      ],
+      "license": "MIT",
+      "engines": {
+        "node": ">=12.20.0"
+      }
+    },
+    "node_modules/on-exit-leak-free": {
+      "version": "2.1.2",
+      "resolved": "https://registry.npmjs.org/on-exit-leak-free/-/on-exit-leak-free-2.1.2.tgz",
+      "integrity": "sha512-0eJJY6hXLGf1udHwfNftBqH+g73EU4B504nZeKpz1sYRKafAghwxEJunB2O7rDZkL4PGfsMVnTXZ2EjibbqcsA==",
+      "license": "MIT",
+      "engines": {
+        "node": ">=14.0.0"
+      }
+    },
+    "node_modules/optionator": {
+      "version": "0.9.4",
+      "resolved": "https://registry.npmjs.org/optionator/-/optionator-0.9.4.tgz",
+      "integrity": "sha512-6IpQ7mKUxRcZNLIObR0hz7lxsapSSIYNZJwXPGeF0mTVqGKFIXj1DQcMoT22S3ROcLyY/rz0PWaWZ9ayWmad9g==",
+      "dev": true,
+      "license": "MIT",
+      "dependencies": {
+        "deep-is": "^0.1.3",
+        "fast-levenshtein": "^2.0.6",
+        "levn": "^0.4.1",
+        "prelude-ls": "^1.2.1",
+        "type-check": "^0.4.0",
+        "word-wrap": "^1.2.5"
+      },
+      "engines": {
         "node": ">= 0.8.0"
       }
     },
@@ -3056,6 +3934,31 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/parse-entities": {
+      "version": "4.0.2",
+      "resolved": "https://registry.npmjs.org/parse-entities/-/parse-entities-4.0.2.tgz",
+      "integrity": "sha512-GG2AQYWoLgL877gQIKeRPGO1xF9+eG1ujIb5soS5gPvLQ1y2o8FL90w2QWNdf9I361Mpp7726c+lj3U0qK1uGw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^2.0.0",
+        "character-entities-legacy": "^3.0.0",
+        "character-reference-invalid": "^2.0.0",
+        "decode-named-character-reference": "^1.0.0",
+        "is-alphanumerical": "^2.0.0",
+        "is-decimal": "^2.0.0",
+        "is-hexadecimal": "^2.0.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/parse-entities/node_modules/@types/unist": {
+      "version": "2.0.11",
+      "resolved": "https://registry.npmjs.org/@types/unist/-/unist-2.0.11.tgz",
+      "integrity": "sha512-CmBKiL6NNo/OqgmMn95Fk9Whlp2mtvIv+KNpQKN2F4SjvrEesubTRWGYSg+BnWZOnlCaSTU1sMpsBOzgbYhnsA==",
+      "license": "MIT"
+    },
     "node_modules/parse5": {
       "version": "8.0.1",
       "resolved": "https://registry.npmjs.org/parse5/-/parse5-8.0.1.tgz",
@@ -3345,6 +4248,16 @@
       ],
       "license": "MIT"
     },
+    "node_modules/property-information": {
+      "version": "7.2.0",
+      "resolved": "https://registry.npmjs.org/property-information/-/property-information-7.2.0.tgz",
+      "integrity": "sha512-IAtzIB6sUiWaJYrX9smp3V46pBGbBeLFRGdh25kg1334VcBlD8HzhPeNIWQH9zhGmo2itIe25EHt9dQP7G5hmg==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/punycode": {
       "version": "2.3.1",
       "resolved": "https://registry.npmjs.org/punycode/-/punycode-2.3.1.tgz",
@@ -3410,6 +4323,33 @@
       "license": "MIT",
       "peer": true
     },
+    "node_modules/react-markdown": {
+      "version": "10.1.0",
+      "resolved": "https://registry.npmjs.org/react-markdown/-/react-markdown-10.1.0.tgz",
+      "integrity": "sha512-qKxVopLT/TyA6BX3Ue5NwabOsAzm0Q7kAPwq6L+wWDwisYs7R8vZ0nRXqq6rkueboxpkjvLGU9fWifiX/ZZFxQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "devlop": "^1.0.0",
+        "hast-util-to-jsx-runtime": "^2.0.0",
+        "html-url-attributes": "^3.0.0",
+        "mdast-util-to-hast": "^13.0.0",
+        "remark-parse": "^11.0.0",
+        "remark-rehype": "^11.0.0",
+        "unified": "^11.0.0",
+        "unist-util-visit": "^5.0.0",
+        "vfile": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      },
+      "peerDependencies": {
+        "@types/react": ">=18",
+        "react": ">=18"
+      }
+    },
     "node_modules/real-require": {
       "version": "0.2.0",
       "resolved": "https://registry.npmjs.org/real-require/-/real-require-0.2.0.tgz",
@@ -3419,6 +4359,39 @@
         "node": ">= 12.13.0"
       }
     },
+    "node_modules/remark-parse": {
+      "version": "11.0.0",
+      "resolved": "https://registry.npmjs.org/remark-parse/-/remark-parse-11.0.0.tgz",
+      "integrity": "sha512-FCxlKLNGknS5ba/1lmpYijMUzX2esxW5xQqjWxw2eHFfS2MSdaHVINFmhjo+qN1WhZhNimq0dZATN9pH0IDrpA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/mdast": "^4.0.0",
+        "mdast-util-from-markdown": "^2.0.0",
+        "micromark-util-types": "^2.0.0",
+        "unified": "^11.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/remark-rehype": {
+      "version": "11.1.2",
+      "resolved": "https://registry.npmjs.org/remark-rehype/-/remark-rehype-11.1.2.tgz",
+      "integrity": "sha512-Dh7l57ianaEoIpzbp0PC9UKAdCSVklD8E5Rpw7ETfbTl3FqcOOgq5q2LVDhgGCkaBv7p24JXikPdvhhmHvKMsw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/hast": "^3.0.0",
+        "@types/mdast": "^4.0.0",
+        "mdast-util-to-hast": "^13.0.0",
+        "unified": "^11.0.0",
+        "vfile": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/require-from-string": {
       "version": "2.0.2",
       "resolved": "https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz",
@@ -3641,6 +4614,16 @@
         "node": ">=0.10.0"
       }
     },
+    "node_modules/space-separated-tokens": {
+      "version": "2.0.2",
+      "resolved": "https://registry.npmjs.org/space-separated-tokens/-/space-separated-tokens-2.0.2.tgz",
+      "integrity": "sha512-PEGlAwrG8yXGXRjW32fGbg66JAlOAwbObuqVoJpv/mRgoWDQfgH1wDPvtzWyUSNAXBGSk8h755YDbbcEy3SH2Q==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/split2": {
       "version": "4.2.0",
       "resolved": "https://registry.npmjs.org/split2/-/split2-4.2.0.tgz",
@@ -3664,6 +4647,38 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/stringify-entities": {
+      "version": "4.0.4",
+      "resolved": "https://registry.npmjs.org/stringify-entities/-/stringify-entities-4.0.4.tgz",
+      "integrity": "sha512-IwfBptatlO+QCJUo19AqvrPNqlVMpW9YEL2LIVY+Rpv2qsjCGxaDLNRgeGsQWJhfItebuJhsGSLjaBbNSQ+ieg==",
+      "license": "MIT",
+      "dependencies": {
+        "character-entities-html4": "^2.0.0",
+        "character-entities-legacy": "^3.0.0"
+      },
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/style-to-js": {
+      "version": "1.1.21",
+      "resolved": "https://registry.npmjs.org/style-to-js/-/style-to-js-1.1.21.tgz",
+      "integrity": "sha512-RjQetxJrrUJLQPHbLku6U/ocGtzyjbJMP9lCNK7Ag0CNh690nSH8woqWH9u16nMjYBAok+i7JO1NP2pOy8IsPQ==",
+      "license": "MIT",
+      "dependencies": {
+        "style-to-object": "1.0.14"
+      }
+    },
+    "node_modules/style-to-object": {
+      "version": "1.0.14",
+      "resolved": "https://registry.npmjs.org/style-to-object/-/style-to-object-1.0.14.tgz",
+      "integrity": "sha512-LIN7rULI0jBscWQYaSswptyderlarFkjQ+t79nzty8tcIAceVomEVlLzH5VP4Cmsv6MtKhs7qaAiwlcp+Mgaxw==",
+      "license": "MIT",
+      "dependencies": {
+        "inline-style-parser": "0.2.7"
+      }
+    },
     "node_modules/symbol-tree": {
       "version": "3.2.4",
       "resolved": "https://registry.npmjs.org/symbol-tree/-/symbol-tree-3.2.4.tgz",
@@ -3781,6 +4796,26 @@
         "node": ">=20"
       }
     },
+    "node_modules/trim-lines": {
+      "version": "3.0.1",
+      "resolved": "https://registry.npmjs.org/trim-lines/-/trim-lines-3.0.1.tgz",
+      "integrity": "sha512-kRj8B+YHZCc9kQYdWfJB2/oUl9rA99qbowYYBtr4ui4mZyAQ2JpvVBd/6U2YloATfqBhBTSMhTpgBHtU0Mf3Rg==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
+    "node_modules/trough": {
+      "version": "2.2.0",
+      "resolved": "https://registry.npmjs.org/trough/-/trough-2.2.0.tgz",
+      "integrity": "sha512-tmMpK00BjZiUyVyvrBK7knerNgmgvcV/KLVyuma/SC+TQN167GrMRciANTz09+k3zW8L8t60jWO1GpfkZdjTaw==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "node_modules/ts-api-utils": {
       "version": "2.5.0",
       "resolved": "https://registry.npmjs.org/ts-api-utils/-/ts-api-utils-2.5.0.tgz",
@@ -3862,6 +4897,93 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/unified": {
+      "version": "11.0.5",
+      "resolved": "https://registry.npmjs.org/unified/-/unified-11.0.5.tgz",
+      "integrity": "sha512-xKvGhPWw3k84Qjh8bI3ZeJjqnyadK+GEFtazSfZv/rKeTkTjOJho6mFqh2SM96iIcZokxiOpg78GazTSg8+KHA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0",
+        "bail": "^2.0.0",
+        "devlop": "^1.0.0",
+        "extend": "^3.0.0",
+        "is-plain-obj": "^4.0.0",
+        "trough": "^2.0.0",
+        "vfile": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/unist-util-is": {
+      "version": "6.0.1",
+      "resolved": "https://registry.npmjs.org/unist-util-is/-/unist-util-is-6.0.1.tgz",
+      "integrity": "sha512-LsiILbtBETkDz8I9p1dQ0uyRUWuaQzd/cuEeS1hoRSyW5E5XGmTzlwY1OrNzzakGowI9Dr/I8HVaw4hTtnxy8g==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/unist-util-position": {
+      "version": "5.0.0",
+      "resolved": "https://registry.npmjs.org/unist-util-position/-/unist-util-position-5.0.0.tgz",
+      "integrity": "sha512-fucsC7HjXvkB5R3kTCO7kUjRdrS0BJt3M/FPxmHMBOm8JQi2BsHAHFsy27E0EolP8rp0NzXsJ+jNPyDWvOJZPA==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/unist-util-stringify-position": {
+      "version": "4.0.0",
+      "resolved": "https://registry.npmjs.org/unist-util-stringify-position/-/unist-util-stringify-position-4.0.0.tgz",
+      "integrity": "sha512-0ASV06AAoKCDkS2+xw5RXJywruurpbC4JZSm7nr7MOt1ojAzvyyaO+UxZf18j8FCF6kmzCZKcAgN/yu2gm2XgQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/unist-util-visit": {
+      "version": "5.1.0",
+      "resolved": "https://registry.npmjs.org/unist-util-visit/-/unist-util-visit-5.1.0.tgz",
+      "integrity": "sha512-m+vIdyeCOpdr/QeQCu2EzxX/ohgS8KbnPDgFni4dQsfSCtpz8UqDyY5GjRru8PDKuYn7Fq19j1CQ+nJSsGKOzg==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0",
+        "unist-util-is": "^6.0.0",
+        "unist-util-visit-parents": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/unist-util-visit-parents": {
+      "version": "6.0.2",
+      "resolved": "https://registry.npmjs.org/unist-util-visit-parents/-/unist-util-visit-parents-6.0.2.tgz",
+      "integrity": "sha512-goh1s1TBrqSqukSc8wrjwWhL0hiJxgA8m4kFxGlQ+8FYQ3C/m11FcTs4YYem7V664AhHVvgoQLk890Ssdsr2IQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0",
+        "unist-util-is": "^6.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/uri-js": {
       "version": "4.4.1",
       "resolved": "https://registry.npmjs.org/uri-js/-/uri-js-4.4.1.tgz",
@@ -3881,6 +5003,34 @@
         "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0"
       }
     },
+    "node_modules/vfile": {
+      "version": "6.0.3",
+      "resolved": "https://registry.npmjs.org/vfile/-/vfile-6.0.3.tgz",
+      "integrity": "sha512-KzIbH/9tXat2u30jf+smMwFCsno4wHVdNmzFyL+T/L3UGqqk6JKfVqOFOZEpZSHADH1k40ab6NUIXZq422ov3Q==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0",
+        "vfile-message": "^4.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
+    "node_modules/vfile-message": {
+      "version": "4.0.3",
+      "resolved": "https://registry.npmjs.org/vfile-message/-/vfile-message-4.0.3.tgz",
+      "integrity": "sha512-QTHzsGd1EhbZs4AsQ20JX1rC3cOlt/IWJruk893DfLRr57lcnOeMaWG4K0JrRta4mIJZKth2Au3mM3u03/JWKw==",
+      "license": "MIT",
+      "dependencies": {
+        "@types/unist": "^3.0.0",
+        "unist-util-stringify-position": "^4.0.0"
+      },
+      "funding": {
+        "type": "opencollective",
+        "url": "https://opencollective.com/unified"
+      }
+    },
     "node_modules/vite": {
       "version": "8.3.0",
       "resolved": "https://registry.npmjs.org/vite/-/vite-8.3.0.tgz",
@@ -4187,6 +5337,16 @@
         "url": "https://github.com/sponsors/sindresorhus"
       }
     },
+    "node_modules/zwitch": {
+      "version": "2.0.4",
+      "resolved": "https://registry.npmjs.org/zwitch/-/zwitch-2.0.4.tgz",
+      "integrity": "sha512-bXE4cR/kVZhKZX/RjPEflHaKVhUVl85noU3v6b8apfQEc1x4A+zBxjZ4lN8LqGd6WZ3dl98pY4o717VFmoPp+A==",
+      "license": "MIT",
+      "funding": {
+        "type": "github",
+        "url": "https://github.com/sponsors/wooorm"
+      }
+    },
     "services/backend": {
       "name": "@trellis/backend",
       "dependencies": {
@@ -4244,7 +5404,8 @@
         "@tanstack/react-query": "^5.103.1",
         "@tanstack/react-router": "^1.170.38",
         "react": "^19.3.0",
-        "react-dom": "^19.3.0"
+        "react-dom": "^19.3.0",
+        "react-markdown": "^10.1.0"
       },
       "devDependencies": {
         "@testing-library/react": "^16.3.3",
diff --git a/services/frontend/package.json b/services/frontend/package.json
index 3f85ef6..5fa5991 100644
--- a/services/frontend/package.json
+++ b/services/frontend/package.json
@@ -13,7 +13,8 @@
     "@tanstack/react-query": "^5.103.1",
     "@tanstack/react-router": "^1.170.38",
     "react": "^19.3.0",
-    "react-dom": "^19.3.0"
+    "react-dom": "^19.3.0",
+    "react-markdown": "^10.1.0"
   },
   "devDependencies": {
     "@testing-library/react": "^16.3.3",
diff --git a/services/frontend/src/App.test.tsx b/services/frontend/src/App.test.tsx
index 71b6516..2891801 100644
--- a/services/frontend/src/App.test.tsx
+++ b/services/frontend/src/App.test.tsx
@@ -54,16 +54,34 @@ describe("App routing", () => {
         jsonResponse({
           courses: [{ id: "c1", version: "1.0.0", title: "Course One", description: "Desc" }],
         }),
-      "/api/courses/c1": () =>
+      "/api/courses/c1/progress": () =>
         jsonResponse({
-          id: "c1",
-          version: "1.0.0",
+          courseId: "c1",
+          courseVersion: "1.0.0",
           title: "Course One",
+          totalLessons: 1,
+          completedLessons: 0,
+          completed: false,
+          orphanedLessons: [],
+          recordedVersions: [],
           modules: [
             {
               id: "m1",
               title: "Module One",
-              lessons: [{ id: "l1", title: "Lesson", hasContent: true, hasQuiz: false, hasPractice: false }],
+              totalLessons: 1,
+              completedLessons: 0,
+              completed: false,
+              lessons: [
+                {
+                  id: "l1",
+                  title: "Lesson",
+                  status: "not_started",
+                  completionMode: "manual",
+                  hasContent: true,
+                  hasQuiz: false,
+                  hasPractice: false,
+                },
+              ],
             },
           ],
         }),
@@ -102,7 +120,7 @@ describe("App routing", () => {
   it("shows a not-found message when the requested course id doesn't exist", async () => {
     mockApi({
       "/api/health": healthOk,
-      "/api/courses/missing": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
+      "/api/courses/missing/progress": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
     });
 
     renderApp("/courses/missing");
diff --git a/services/frontend/src/api/client.ts b/services/frontend/src/api/client.ts
index f466e07..b10148f 100644
--- a/services/frontend/src/api/client.ts
+++ b/services/frontend/src/api/client.ts
@@ -1,4 +1,12 @@
-import type { ApiErrorResponse, CourseDetailResponse, CoursesListResponse, HealthResponse } from "./types";
+import type {
+  ApiErrorResponse,
+  CourseDetailResponse,
+  CourseProgressResponse,
+  CoursesListResponse,
+  HealthResponse,
+  LessonCompletionResponse,
+  LessonDetailResponse,
+} from "./types";
 
 /**
  * Thrown for any non-2xx response. Carries the parsed JSON body (when the
@@ -59,4 +67,18 @@ export const api = {
 
   getCourse: (courseId: string): Promise<CourseDetailResponse> =>
     apiFetch<CourseDetailResponse>(`/courses/${encodeURIComponent(courseId)}`),
+
+  getCourseProgress: (courseId: string): Promise<CourseProgressResponse> =>
+    apiFetch<CourseProgressResponse>(`/courses/${encodeURIComponent(courseId)}/progress`),
+
+  getLesson: (courseId: string, lessonId: string): Promise<LessonDetailResponse> =>
+    apiFetch<LessonDetailResponse>(
+      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
+    ),
+
+  completeLesson: (courseId: string, lessonId: string): Promise<LessonCompletionResponse> =>
+    apiFetch<LessonCompletionResponse>(
+      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/complete`,
+      { method: "POST" },
+    ),
 };
diff --git a/services/frontend/src/api/types.ts b/services/frontend/src/api/types.ts
index 6fc476a..8df96e2 100644
--- a/services/frontend/src/api/types.ts
+++ b/services/frontend/src/api/types.ts
@@ -56,3 +56,103 @@ export interface ApiErrorResponse {
   error: string;
   message: string;
 }
+
+/** A quiz option as the API exposes it — `correct`/`explanation`-per-wrong-
+ * option are stripped server-side (routes/courses.ts's `toLessonResponse`),
+ * so this type must never gain those fields. */
+export interface PublicQuizOption {
+  id: string;
+  text: string;
+}
+
+export interface PublicQuiz {
+  question: string;
+  options: PublicQuizOption[];
+}
+
+export interface PublicPractice {
+  sandbox: string;
+  prompt: string;
+}
+
+/** GET /courses/:courseId/lessons/:lessonId — routes/courses.ts,
+ * `lessonResponseSchema`. `content` is the lesson's Markdown body (may be
+ * absent for a quiz/practice-only lesson — mirrors `hasContent` on the
+ * summary shapes above). */
+export interface LessonDetailResponse {
+  id: string;
+  title: string;
+  content?: string;
+  quiz?: PublicQuiz;
+  practice?: PublicPractice;
+}
+
+/** How a lesson is allowed to become `completed` — routes/progress.ts /
+ * progress/model.ts's `LessonCompletionMode`. `manual` is the only mode the
+ * "mark as done" button is allowed to act on; `quiz`/`practice` are earned
+ * elsewhere and the backend 409s a manual-complete attempt against them. */
+export type LessonCompletionMode = "manual" | "quiz" | "practice";
+
+export type LessonStatus = "completed" | "not_started";
+
+/** One lesson inside `GET /courses/:courseId/progress` — routes/progress.ts,
+ * `lessonProgressSchema`. */
+export interface LessonProgress {
+  id: string;
+  title: string;
+  status: LessonStatus;
+  /** Present only when `status === "completed"`. */
+  completedAt?: string;
+  completionMode: LessonCompletionMode;
+  hasContent: boolean;
+  hasQuiz: boolean;
+  hasPractice: boolean;
+}
+
+export interface ModuleProgress {
+  id: string;
+  title: string;
+  totalLessons: number;
+  completedLessons: number;
+  completed: boolean;
+  lessons: LessonProgress[];
+}
+
+/** A stored completion whose lesson no longer exists in the course as
+ * installed right now (`orphanedProgressSchema`) — diagnostic only. */
+export interface OrphanedProgress {
+  lessonId: string;
+  completedAt: string;
+  courseVersion?: string;
+}
+
+/** GET /courses/:courseId/progress — routes/progress.ts,
+ * `courseProgressResponseSchema`. The course tree joined with per-lesson
+ * completion status; this is what course/lesson navigation renders from,
+ * not `CourseDetailResponse` (which has no status). */
+export interface CourseProgressResponse {
+  courseId: string;
+  courseVersion: string;
+  title: string;
+  totalLessons: number;
+  completedLessons: number;
+  completed: boolean;
+  modules: ModuleProgress[];
+  orphanedLessons: OrphanedProgress[];
+  recordedVersions: string[];
+}
+
+/** Response shape shared by both progress-mutating routes
+ * (`lessonCompletionResponseSchema`) — the affected lesson's fresh status
+ * plus the course's counters, so the caller never needs a second request to
+ * redraw "N of M done" after marking something. */
+export interface LessonCompletionResponse {
+  lesson: LessonProgress;
+  course: {
+    courseId: string;
+    courseVersion: string;
+    totalLessons: number;
+    completedLessons: number;
+    completed: boolean;
+  };
+}
diff --git a/services/frontend/src/index.css b/services/frontend/src/index.css
index 83738bf..3ffd8c5 100644
--- a/services/frontend/src/index.css
+++ b/services/frontend/src/index.css
@@ -137,3 +137,71 @@ a {
 .muted-note {
   color: var(--color-text-muted);
 }
+
+.lesson-list {
+  list-style: none;
+  margin: 0.5rem 0 0;
+  padding: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 0.4rem;
+}
+
+.lesson-link {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 0.75rem;
+  padding: 0.5rem 0.75rem;
+  border-radius: 0.5rem;
+  border: 1px solid var(--color-border);
+  text-decoration: none;
+  color: inherit;
+  font-size: 0.9rem;
+}
+
+.lesson-link:hover {
+  border-color: var(--color-accent);
+}
+
+.lesson-status {
+  font-size: 0.8rem;
+  color: var(--color-text-muted);
+}
+
+.lesson-status--completed {
+  color: var(--color-status-ok);
+}
+
+.lesson-content {
+  margin: 1rem 0;
+  line-height: 1.6;
+}
+
+.lesson-content pre {
+  background-color: var(--color-surface);
+  border: 1px solid var(--color-border);
+  border-radius: 0.5rem;
+  padding: 0.75rem 1rem;
+  overflow-x: auto;
+}
+
+.lesson-content code {
+  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
+}
+
+.mark-done-button {
+  background-color: var(--color-accent);
+  color: var(--color-bg);
+  border: none;
+  border-radius: 0.5rem;
+  padding: 0.6rem 1.25rem;
+  font-size: 0.9rem;
+  font-weight: 600;
+  cursor: pointer;
+}
+
+.mark-done-button:disabled {
+  opacity: 0.6;
+  cursor: default;
+}
diff --git a/services/frontend/src/routes.tsx b/services/frontend/src/routes.tsx
index b656fa5..22b7f43 100644
--- a/services/frontend/src/routes.tsx
+++ b/services/frontend/src/routes.tsx
@@ -1,18 +1,19 @@
 import { useQuery } from "@tanstack/react-query";
 import { Link, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
 import type { RouterHistory } from "@tanstack/react-router";
-import { ApiError, api } from "./api/client";
+import { api } from "./api/client";
+import { CoursePage } from "./features/course/CoursePage";
+import { LessonView } from "./features/lesson/LessonView";
 import { Layout } from "./ui/Layout";
 
 /**
  * Route tree, built with TanStack Router's code-based API (no file-based
  * routing plugin — nothing in this package generates route files, so
- * there's nothing extra to wire into vite.config.ts). Pages here are
- * intentionally thin: full course navigation (module/lesson tree, status,
- * Markdown rendering, mark-as-done) is task 013's job, not this one's — this
- * file only proves the routing + typed client + layout all wire together
- * end to end, the same way task 004's App.tsx proved the dev-proxy worked
- * by doing the smallest possible real fetch instead of a stub.
+ * there's nothing extra to wire into vite.config.ts). `CoursePage` and
+ * `LessonView` (task 013) do the real course-navigation work; this file
+ * only wires their routes into the tree, the same way task 004's App.tsx
+ * proved the dev-proxy worked by doing the smallest possible real fetch
+ * before this grew.
  */
 
 // `Layout` renders the shared header + `<Outlet />`; every route's own
@@ -30,7 +31,22 @@ const indexRoute = createRoute({
 const courseRoute = createRoute({
   getParentRoute: () => rootRoute,
   path: "/courses/$courseId",
-  component: CourseDetailPage,
+  component: () => <CoursePage courseId={courseRoute.useParams().courseId} />,
+});
+
+// Deliberately a top-level route (parent: rootRoute), not a child of
+// courseRoute — task-011's report left the choice open ("сама выберет
+// форму"). Nesting it under courseRoute would force CoursePage to render an
+// `<Outlet />` and keep the module list mounted behind the lesson, i.e. a
+// master-detail layout nobody asked for; a lesson is its own full page here,
+// same shape as courseRoute itself.
+const lessonRoute = createRoute({
+  getParentRoute: () => rootRoute,
+  path: "/courses/$courseId/lessons/$lessonId",
+  component: () => {
+    const { courseId, lessonId } = lessonRoute.useParams();
+    return <LessonView courseId={courseId} lessonId={lessonId} />;
+  },
 });
 
 function CoursesIndexPage() {
@@ -68,45 +84,6 @@ function CoursesIndexPage() {
   );
 }
 
-function CourseDetailPage() {
-  const { courseId } = courseRoute.useParams();
-  const { data, isPending, isError, error } = useQuery({
-    queryKey: ["course", courseId],
-    queryFn: () => api.getCourse(courseId),
-  });
-
-  if (isPending) {
-    return <p className="muted-note">Загружаем курс…</p>;
-  }
-
-  if (isError) {
-    // Only an actual 404 from the backend means "no such course" — any
-    // other failure (network error, 500, etc.) gets the same generic
-    // message CoursesIndexPage uses for the same failure class above.
-    if (error instanceof ApiError && error.status === 404) {
-      return <p className="muted-note">Курс «{courseId}» не найден.</p>;
-    }
-    return <p className="muted-note">Не удалось загрузить курс.</p>;
-  }
-
-  return (
-    <>
-      <h1 className="page-heading">{data.title}</h1>
-      {data.description !== undefined && <p className="muted-note">{data.description}</p>}
-      {/* Interactive module/lesson navigation (statuses, content, mark-as-done)
-          is task 013 — this only proves the course was fetched by id. */}
-      <ul className="card-list">
-        {data.modules.map((module) => (
-          <li key={module.id} className="card-list-item">
-            <h3>{module.title}</h3>
-            <p>{module.lessons.length} урок(ов)</p>
-          </li>
-        ))}
-      </ul>
-    </>
-  );
-}
-
 function NotFoundPage() {
   return (
     <>
@@ -118,7 +95,7 @@ function NotFoundPage() {
   );
 }
 
-const routeTree = rootRoute.addChildren([indexRoute, courseRoute]);
+const routeTree = rootRoute.addChildren([indexRoute, courseRoute, lessonRoute]);
 
 /**
  * Factory instead of a single module-level singleton so tests can build a
```

## Untracked files (new, not yet added)

### services/frontend/src/features/course/CoursePage.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../routes";

// Same routing test pattern as App.test.tsx / task-011's report ("Тестовый
// паттерн для страниц с роутингом"): CoursePage renders `<Link>`s, which
// need real router context, so it's exercised through `createAppRouter`
// with a memory history rather than mounted standalone.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockApi(handlers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const handler = handlers[url];
      if (handler === undefined) {
        throw new Error(`unexpected fetch to ${url}`);
      }
      return handler();
    }),
  );
}

const healthOk = () => jsonResponse({ status: "ok", db: "ok" });

describe("CoursePage", () => {
  it("renders modules with per-lesson status and links each lesson (happy path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1": () =>
        jsonResponse({
          id: "c1",
          version: "1.0.0",
          title: "Course One",
          description: "Learn the basics.",
          modules: [],
        }),
      "/api/courses/c1/progress": () =>
        jsonResponse({
          courseId: "c1",
          courseVersion: "1.0.0",
          title: "Course One",
          totalLessons: 2,
          completedLessons: 1,
          completed: false,
          orphanedLessons: [],
          recordedVersions: [],
          modules: [
            {
              id: "m1",
              title: "Module One",
              totalLessons: 2,
              completedLessons: 1,
              completed: false,
              lessons: [
                {
                  id: "l1",
                  title: "Lesson One",
                  status: "completed",
                  completionMode: "manual",
                  hasContent: true,
                  hasQuiz: false,
                  hasPractice: false,
                },
                {
                  id: "l2",
                  title: "Lesson Two",
                  status: "not_started",
                  completionMode: "quiz",
                  hasContent: true,
                  hasQuiz: true,
                  hasPractice: false,
                },
              ],
            },
          ],
        }),
    });

    renderAt("/courses/c1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Course One" })).toBeTruthy());
    // description comes from a second, non-blocking `getCourse` fetch
    // (`CourseProgressResponse` itself has no such field) — review finding
    // on task-013's fix round.
    await waitFor(() => expect(screen.getByText("Learn the basics.")).toBeTruthy());
    // Both the course header and its single module report the same "1 / 2"
    // counters here (one module holding both lessons) — assert there are
    // two, not that the text is unique.
    expect(screen.getAllByText("1 / 2 уроков пройдено")).toHaveLength(2);
    expect(screen.getByText("Пройден")).toBeTruthy();
    expect(screen.getByText("Не начат")).toBeTruthy();

    const lessonLink = screen.getByRole("link", { name: /Lesson One/ });
    expect(lessonLink.getAttribute("href")).toBe("/courses/c1/lessons/l1");
  });

  it("shows a generic error message on a non-404 failure (error path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/progress": () => jsonResponse({ error: "internal_error", message: "boom" }, 500),
    });

    renderAt("/courses/c1");

    await waitFor(() => expect(screen.getByText("Не удалось загрузить курс.")).toBeTruthy());
  });

  it("shows a not-found message for a missing course (edge case)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/missing/progress": () => jsonResponse({ error: "course_not_found", message: "not found" }, 404),
    });

    renderAt("/courses/missing");

    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
  });
});
```

### services/frontend/src/features/course/CoursePage.tsx

```
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../../api/client";
import { ModuleList } from "./ModuleList";

/**
 * Course navigation page: module/lesson tree with per-lesson statuses.
 * Fetches `GET /courses/:courseId/progress` (not `CourseDetailResponse` —
 * that shape carries no status) so the tree it renders already has
 * completed/not_started joined onto every lesson, per task-011's report.
 *
 * `description` lives only on `CourseDetailResponse`, not on the progress
 * shape above (`courseProgressResponseSchema` has no such field), so a
 * second, non-blocking `getCourse` fetch supplies it — review finding on
 * task-013. Deliberately not gated on its own loading/error state: the
 * description is a supplementary enhancement to a page whose primary
 * content (title, counters, module tree) already renders from the
 * progress query; `courseQuery.data?.description` simply renders nothing
 * extra while pending or on failure, same "don't block the page for a
 * secondary field" call `LessonView`'s two-query split documents.
 */
export function CoursePage({ courseId }: { courseId: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });
  const { data: courseData } = useQuery({
    queryKey: ["course", courseId],
    queryFn: () => api.getCourse(courseId),
  });

  if (isPending) {
    return <p className="muted-note">Загружаем курс…</p>;
  }

  if (isError) {
    // Same narrowing as the old CourseDetailPage (task-011 fix round): only
    // a genuine 404 means "no such course" — any other failure gets the
    // generic message CoursesIndexPage uses for the same failure class.
    if (error instanceof ApiError && error.status === 404) {
      return <p className="muted-note">Курс «{courseId}» не найден.</p>;
    }
    return <p className="muted-note">Не удалось загрузить курс.</p>;
  }

  return (
    <>
      <h1 className="page-heading">{data.title}</h1>
      {courseData?.description !== undefined && <p className="muted-note">{courseData.description}</p>}
      <p className="muted-note">
        {data.completedLessons} / {data.totalLessons} уроков пройдено
      </p>
      <ModuleList courseId={courseId} modules={data.modules} />
    </>
  );
}
```

### services/frontend/src/features/course/ModuleList.tsx

```
import { Link } from "@tanstack/react-router";
import type { ModuleProgress } from "../../api/types";

const LESSON_STATUS_LABEL: Record<"completed" | "not_started", string> = {
  completed: "Пройден",
  not_started: "Не начат",
};

/**
 * Pure presentational list of a course's modules and lessons, each lesson
 * a link to its own page carrying its current status. No data fetching here
 * — `CoursePage` owns the query and passes the already-joined progress tree
 * down, keeping this component testable with plain props.
 */
export function ModuleList({ courseId, modules }: { courseId: string; modules: readonly ModuleProgress[] }) {
  return (
    <ul className="card-list">
      {modules.map((module) => (
        <li key={module.id} className="card-list-item">
          <h3>{module.title}</h3>
          <p className="muted-note">
            {module.completedLessons} / {module.totalLessons} уроков пройдено
          </p>
          <ul className="lesson-list">
            {module.lessons.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  to="/courses/$courseId/lessons/$lessonId"
                  params={{ courseId, lessonId: lesson.id }}
                  className="lesson-link"
                >
                  <span>{lesson.title}</span>
                  <span className={`lesson-status lesson-status--${lesson.status}`}>
                    {LESSON_STATUS_LABEL[lesson.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
```

### services/frontend/src/features/lesson/LessonView.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "../../routes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockApi(handlers: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const handler = handlers[url];
      if (handler === undefined) {
        throw new Error(`unexpected fetch to ${url}`);
      }
      return handler();
    }),
  );
}

const healthOk = () => jsonResponse({ status: "ok", db: "ok" });

function manualProgress(status: "completed" | "not_started") {
  return jsonResponse({
    courseId: "c1",
    courseVersion: "1.0.0",
    title: "Course One",
    totalLessons: 1,
    completedLessons: status === "completed" ? 1 : 0,
    completed: status === "completed",
    orphanedLessons: [],
    recordedVersions: [],
    modules: [
      {
        id: "m1",
        title: "Module One",
        totalLessons: 1,
        completedLessons: status === "completed" ? 1 : 0,
        completed: status === "completed",
        lessons: [
          {
            id: "l1",
            title: "Lesson One",
            status,
            completionMode: "manual",
            hasContent: true,
            hasQuiz: false,
            hasPractice: false,
          },
        ],
      },
    ],
  });
}

describe("LessonView", () => {
  it("renders the lesson's Markdown content and marks it done on click (happy path)", async () => {
    let completed = false;
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () =>
        jsonResponse({ id: "l1", title: "Lesson One", content: "# Heading\n\nSome text." }),
      "/api/courses/c1/progress": () => manualProgress(completed ? "completed" : "not_started"),
      "/api/courses/c1/lessons/l1/complete": () => {
        completed = true;
        return jsonResponse({
          lesson: {
            id: "l1",
            title: "Lesson One",
            status: "completed",
            completionMode: "manual",
            hasContent: true,
            hasQuiz: false,
            hasPractice: false,
          },
          course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: 1, completed: true },
        });
      },
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy());
    expect(screen.getByText("Some text.")).toBeTruthy();

    const button = screen.getByRole("button", { name: "Отметить пройденным" });
    const user = userEvent.setup();
    await user.click(button);

    await waitFor(() => expect(screen.getByText("Урок отмечен как пройденный.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Отметить пройденным" })).toBeNull();
  });

  it("hides the mark-done button for a quiz-graded lesson and explains why (edge case)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/l1": () => jsonResponse({ id: "l1", title: "Quiz Lesson", content: "Body." }),
      "/api/courses/c1/progress": () =>
        jsonResponse({
          courseId: "c1",
          courseVersion: "1.0.0",
          title: "Course One",
          totalLessons: 1,
          completedLessons: 0,
          completed: false,
          orphanedLessons: [],
          recordedVersions: [],
          modules: [
            {
              id: "m1",
              title: "Module One",
              totalLessons: 1,
              completedLessons: 0,
              completed: false,
              lessons: [
                {
                  id: "l1",
                  title: "Quiz Lesson",
                  status: "not_started",
                  completionMode: "quiz",
                  hasContent: true,
                  hasQuiz: true,
                  hasPractice: false,
                },
              ],
            },
          ],
        }),
    });

    renderAt("/courses/c1/lessons/l1");

    await waitFor(() => expect(screen.getByText("Урок завершается правильным ответом на квиз.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Отметить пройденным" })).toBeNull();
  });

  it("shows a not-found message for an unknown lesson (error path)", async () => {
    mockApi({
      "/api/health": healthOk,
      "/api/courses/c1/lessons/missing": () => jsonResponse({ error: "lesson_not_found", message: "nope" }, 404),
      "/api/courses/c1/progress": () => manualProgress("not_started"),
    });

    renderAt("/courses/c1/lessons/missing");

    await waitFor(() => expect(screen.getByText(/не найден/)).toBeTruthy());
  });
});
```

### services/frontend/src/features/lesson/LessonView.tsx

```
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApiError, api } from "../../api/client";
import type { LessonCompletionMode } from "../../api/types";
import { Markdown } from "./Markdown";

const NON_MANUAL_NOTE: Record<Exclude<LessonCompletionMode, "manual">, string> = {
  quiz: "Урок завершается правильным ответом на квиз.",
  practice: "Урок завершается прохождением проверки практики.",
};

/**
 * Single lesson page: renders its Markdown content and, for lessons whose
 * `completionMode` is "manual" (progress/model.ts — plain content or a
 * practice without a `check`), the explicit "mark as done" button. A
 * quiz/practice-graded lesson never gets that button — the backend would
 * 409 a manual completion attempt against it (routes/progress.ts), and
 * hiding the control here is cheaper and clearer than surfacing that error.
 *
 * Two queries instead of one: the lesson's Markdown body comes from
 * `GET /courses/:courseId/lessons/:lessonId` (no status field on that
 * shape), its status/completionMode comes from the course's progress tree
 * (`GET /courses/:courseId/progress`, the same query `CoursePage` uses —
 * same `queryKey`, so completing a lesson here and going back to the course
 * list re-renders both from one cache entry).
 */
export function LessonView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const queryClient = useQueryClient();

  const contentQuery = useQuery({
    queryKey: ["lesson", courseId, lessonId],
    queryFn: () => api.getLesson(courseId, lessonId),
  });

  const progressQuery = useQuery({
    queryKey: ["courseProgress", courseId],
    queryFn: () => api.getCourseProgress(courseId),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.completeLesson(courseId, lessonId),
    onSuccess: () => {
      // Re-fetch rather than hand-patch the cache: the response also carries
      // fresh module/course counters this component doesn't otherwise see.
      void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
    },
  });

  if (contentQuery.isPending || progressQuery.isPending) {
    return <p className="muted-note">Загружаем урок…</p>;
  }

  if (contentQuery.isError || progressQuery.isError) {
    const notFound =
      (contentQuery.error instanceof ApiError && contentQuery.error.status === 404) ||
      (progressQuery.error instanceof ApiError && progressQuery.error.status === 404);
    return (
      <p className="muted-note">{notFound ? `Урок «${lessonId}» не найден.` : "Не удалось загрузить урок."}</p>
    );
  }

  const lessonProgress = progressQuery.data.modules
    .flatMap((module) => module.lessons)
    .find((candidate) => candidate.id === lessonId);

  if (lessonProgress === undefined) {
    // Lesson exists in content (contentQuery succeeded) but not in the
    // progress tree — only reachable if the course changed on disk between
    // the two requests (a rescan). Same "not found" wording as the 404 path
    // above; the cause doesn't change what the user should do about it.
    return <p className="muted-note">Урок «{lessonId}» не найден.</p>;
  }

  const isCompleted = lessonProgress.status === "completed";

  return (
    <>
      <p className="muted-note">
        <Link to="/courses/$courseId" params={{ courseId }}>
          ← К курсу
        </Link>
      </p>
      <h1 className="page-heading">{contentQuery.data.title}</h1>
      {contentQuery.data.content !== undefined && <Markdown source={contentQuery.data.content} />}
      <CompletionControl
        mode={lessonProgress.completionMode}
        isCompleted={isCompleted}
        onComplete={() => completeMutation.mutate()}
        isPending={completeMutation.isPending}
        isError={completeMutation.isError}
      />
    </>
  );
}

function CompletionControl({
  mode,
  isCompleted,
  onComplete,
  isPending,
  isError,
}: {
  mode: LessonCompletionMode;
  isCompleted: boolean;
  onComplete: () => void;
  isPending: boolean;
  isError: boolean;
}) {
  if (mode !== "manual") {
    return <p className="muted-note">{isCompleted ? "Урок пройден." : NON_MANUAL_NOTE[mode]}</p>;
  }

  if (isCompleted) {
    return <p className="muted-note">Урок отмечен как пройденный.</p>;
  }

  return (
    <>
      <button type="button" className="mark-done-button" onClick={onComplete} disabled={isPending}>
        {isPending ? "Отмечаем…" : "Отметить пройденным"}
      </button>
      {isError && <p className="muted-note">Не удалось отметить урок пройденным.</p>}
    </>
  );
}
```

### services/frontend/src/features/lesson/Markdown.test.tsx

```
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(() => {
  cleanup();
});

describe("Markdown", () => {
  it("renders headings and paragraphs from the source text (happy path)", () => {
    render(<Markdown source={"# Title\n\nBody text."} />);

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(screen.getByText("Body text.")).toBeTruthy();
  });

  it("renders a fenced code block as <pre><code> (edge case — SQL lesson examples)", () => {
    render(<Markdown source={"```sql\nSELECT 1;\n```"} />);

    const code = screen.getByText("SELECT 1;", { exact: false });
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).not.toBeNull();
  });

  it("never executes embedded HTML/script content (security path)", () => {
    render(<Markdown source={"<script>window.__markdownPwned = true;</script>"} />);

    // react-markdown parses CommonMark into React elements, never raw HTML
    // (no rehype-raw plugin, no dangerouslySetInnerHTML) — a script tag in
    // course content must never run.
    expect((window as unknown as { __markdownPwned?: boolean }).__markdownPwned).toBeUndefined();
  });
});
```

### services/frontend/src/features/lesson/Markdown.tsx

```
import ReactMarkdown from "react-markdown";

/**
 * Renders a lesson's Markdown body. `react-markdown` builds React elements
 * from the parsed AST instead of injecting HTML (no `dangerouslySetInnerHTML`
 * anywhere in this app) — course content is a third-party-authored package
 * under `courses/` (project invariant: it's data, not code the core wrote),
 * so this is the one place user-facing untrusted-ish text actually renders.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="lesson-content">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}
```

