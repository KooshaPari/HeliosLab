# Iconography Standard

- **Status:** Active
- **Repo:** KooshaPari/HeliosLab
- **Date:** 2026-05-02

## Style Guide

Three icon styles are used across this repo:

| Style | Description | Use case |
|-------|-------------|----------|
| Fluent (stroke) | Outlined, 1.5px stroke, `currentColor` | CLI tools, UI controls |
| Material (filled+outlined) | Filled primary, outlined secondary | Navigation, actions |
| Liquid Glass (blur) | Frosted glass effect with backdrop-blur | Decorative, hero sections |

## Requirements

All icons:
- 24×24 SVG viewport
- `currentColor` fill/stroke
- `role="img"`
- `aria-label` attribute
- UTF-8, no BOM

## Directory Layout

```
docs/operations/iconography/
  fluent/      # Fluent System Icons (stroke)
  material/    # Material Design Icons (filled + outlined)
  liquid/      # Liquid Glass decorative icons
  SPEC.md      # This file
```

## Related

- [Phenotype iconography standard](https://github.com/kooshapari/phenotype-infra/blob/main/docs/governance/iconography-standard.md)
- `docs/operations/journey-traceability.md`
