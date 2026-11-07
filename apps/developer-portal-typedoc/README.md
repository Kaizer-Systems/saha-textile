<!--
NEXT-GEN-UI
What: TypeDoc entry-page orientation for the Type Lattice child.
Why: establish shared portal context before source-generated symbol navigation.
How: semantic HTML classes consume only the composed TypeDoc adapter.
Tuning knobs: intro hierarchy and copy; layout remains in theme/adapter.css.
-->

This generated surface documents the exported TypeScript contracts and core-domain ports/pricing utilities that are useful across application boundaries.

<div class="portal-typedoc-intro" role="note">
<span class="portal-typedoc-intro__eyebrow">Type Lattice · exported surface</span>
<strong>Source-resolved contracts, ports, and pricing primitives.</strong>
<p>Follow a symbol from its public entry point into signatures, constraints, and source evidence without mixing HTTP operations or narrative architecture into this reference.</p>
</div>

It is intentionally narrower than the developer portal:

- **TypeDoc owns:** exported symbols, signatures, types, schemas, interfaces, and source-linked API details.
- **Docusaurus owns:** architecture, business meaning, implementation status, workflows, security policy, operational guidance, and decisions.
- **Scalar owns:** the generated HTTP/OpenAPI operation contract and approved Test Request workflow; its current scaffold remains visibly incomplete where operation metadata is missing.

Generation reads repository source only. It does not inspect production services, databases, credentials, or customer data.
