# Release Guide

## 1) Validate

```bash
npm ci
npm test
npm run mock:check -- --spec ./examples/petstore.yaml
```

## 2) Version bump

```bash
npm version patch
```

## 3) Publish

```bash
npm publish
```

## 4) Push source + tags

```bash
git push
git push --tags
```

## 5) Verify

```bash
npm view openapi-mock-darksol version
```

---

## Ship preflight (required)

```bash
where gh
gh auth status
npm whoami
```

If `gh` is unavailable in runtime, use browser-based repo creation and push with git remote URL.
