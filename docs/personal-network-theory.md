# Relationship and network theory

Reference notes for the model behind Orbit's relationships, groupings and
opportunities. This is a theory document, not a specification. Where a claim
here becomes a shipped behaviour, the behaviour belongs in the contact profile
contract or the development log.

## Provenance of this document

The project's own rule is that a surfaced conclusion should declare where it
came from, so this document does the same.

- **Extracted** items came from the five FudanDISC research repositories that
  were held under `repos/` and have since been removed. They are marked with
  their source paper.
- **Established** items are standard social network theory, cited to the
  original work so they can be checked.
- **Applied** items are this project's reading of the above. They are
  judgements, not findings, and should be argued with.

## What the research repositories actually contributed

The five repositories were assessed for transferable thinking about
interactions, groupings and connections. Three ideas survived. They are
recorded here so the repositories themselves need not be kept.

### Memory stream retrieval (extracted)

Park et al., *Generative Agents: Interactive Simulacra of Human Behavior*
(arXiv:2304.03442).

An agent holds a long, append-only stream of timestamped observations. When
context is needed, observations are retrieved by a weighted sum of three
independent scores:

- **Recency**, decaying exponentially since last access.
- **Importance**, assigned once when the observation is recorded, separating
  the mundane from the significant.
- **Relevance**, similarity to the current query or situation.

Above the stream sits **reflection**: periodically the agent synthesises
higher-level statements from clusters of observations, and each reflection
keeps pointers back to the observations that produced it.

This is the closest thing in the whole corpus to Orbit's problem. Orbit's
Interactions are the observation stream, Facts are the reflections, and
Evidence is the pointer set. The useful discipline is that importance is
recorded at capture time rather than inferred at read time, and that a
synthesised statement never loses its links to what produced it.

Applied: a Contact Profile's "Current context" is a retrieval problem, not a
sort by date. The last interaction is not automatically the relevant one. A
significant conversation from eight months ago should outrank a logistical
email from Tuesday, and the profile should be able to say which of the three
scores put it there.

### Reciprocity and exchange over time (extracted)

Wang et al., *Investigating and Extending Homans' Social Exchange Theory with
Large Language Model based Agents* (arXiv:2502.12450).

Homans' social exchange theory treats a relationship as a running ledger of
costs and benefits, where continuation depends on the perceived fairness of
the exchange rather than on volume of contact.

Applied: relationship strength should be sensitive to direction and balance,
not just to frequency. Orbit already stores directional relationships. Two
people who exchange initiations are in a different state from a pair where one
side always initiates, even at identical message counts. Reciprocity is a
better decay signal than silence alone.

### Beliefs and interests over attributes (extracted)

Chuang et al., *Beyond Demographics: Aligning Role-playing LLM-based Agents
Using Human Belief Networks* (arXiv:2406.17232).

Shared beliefs and interests predicted behaviour substantially better than
demographic attributes did.

Applied: prefer interest and expertise overlap over category labels when
suggesting connections or grouping people. A shared project is a stronger
signal than a shared employer, and much stronger than a shared city.

### The negative result (extracted, and the most useful part)

The corpus was searched for every concept that governs interactions, groupings
and connections: homophily, tie strength, community detection, structural
holes, brokerage, centrality, Dunbar layers, social capital, reciprocity,
triadic closure, clustering coefficient, ego networks, weak ties. **Zero
matches across all five repositories.**

The reason is structural. That literature generates plausible synthetic people
in order to predict an aggregate: an election result, a consumption
distribution, an opinion cascade. No individual needs to be correct, only the
distribution. Orbit represents specific real people from evidence, where a
plausible invention is a defect rather than the goal.

Do not import its habits. Specifically: no inferred attribute should ever be
written back as though it were observed, and no population prior should be
used to fill a gap in an individual's record. This is the same rule the
project already states about distinguishing user-entered, sourced, calculated
and inferred material. The simulation framing quietly breaks it.

## Tie strength

Established. Granovetter, *The Strength of Weak Ties* (1973).

Tie strength is a combination of four things, not one: time spent, emotional
intensity, intimacy, and reciprocal services. Frequency alone is a poor proxy.

Weak ties carry novel information because they reach outside the dense cluster
where everyone already knows what everyone else knows. Strong ties are where
support and trust live, but they are informationally redundant. The practical
consequence is that the most useful contact for an introduction or an
unfamiliar problem is frequently not the closest one.

Applied to Orbit's existing "Strength and trajectory" field:

- Strength should be a small vector, surfaced as one number but explainable as
  its parts. Frequency, recency, reciprocity, duration of the relationship,
  and breadth of context are separable and can move in opposite directions.
- Trajectory matters independently of level. A moderate tie that is warming is
  a different opportunity from a moderate tie that is cooling.
- Do not treat low frequency as low value. Cadence is relative to the specific
  relationship, and an annual contact can be entirely healthy. Compare a
  relationship to its own history rather than to a global threshold.

## Structural holes and brokerage

Established. Burt, *Structural Holes: The Social Structure of Competition*
(1992).

A structural hole is a gap between two clusters that have no direct
connection. Whoever spans the gap holds a brokerage position, with early
access to information from both sides and control over what passes between
them. Burt's argument is that the advantage comes from the non-redundancy of
the contacts, not from the count of them.

Applied: Orbit already computes bridges. The theory adds what to do with them.

- A person's network value is better measured by how many distinct clusters
  they reach than by their raw degree. Someone with forty contacts inside one
  cluster is less useful for an introduction than someone with twelve spread
  across four.
- The user's own brokerage positions are the actionable ones. Where the user
  is the only link between two clusters, that is both an opportunity and a
  fragility.
- A missing edge between two clusters that share several second-degree
  connections is a suggestion candidate. This is the honest version of
  "suggested relationships": it proposes a plausible introduction, not an
  asserted fact.

## Triadic closure and homophily

Established. Rapoport (1953) on closure; McPherson, Smith-Lovin and Cook,
*Birds of a Feather* (2001) on homophily.

Triadic closure: two people with a common connection are disproportionately
likely to become connected. Homophily: connections form between similar people
at rates well above chance, on both ascribed and acquired traits.

Both are useful for suggestion and dangerous for inference.

- Useful: an unclosed triangle with several shared connections is a reasonable
  place to suggest a link, and clusters detected by shared connection density
  usually correspond to real groups the user would recognise.
- Dangerous: homophily makes it tempting to infer an unknown attribute from a
  person's neighbours. Orbit must not do this. Guessing someone's employer,
  politics or location from who they know produces a confident fabrication
  with no evidence behind it, and it is precisely the failure mode the
  simulation literature above normalises.

The line is that structure may suggest a **connection to review**. Structure
may never populate a **fact about a person**.

## Dunbar layers

Established. Dunbar (1993) and subsequent work on layer structure.

Personal networks organise into roughly concentric layers of approximate sizes
5, 15, 50, 150, 500 and 1500, each with markedly lower contact frequency and
emotional closeness than the one inside it. The layers are a consequence of
finite time and attention, and the total is bounded.

Applied: this is the natural theory behind Orbit's orbit bands, and it changes
what the bands mean. They are not a visual convenience but a claim about
capacity. Two consequences follow.

- Attention is zero-sum. A recommendation to invest in one relationship is
  implicitly a recommendation to spend less elsewhere, and the product should
  not pretend otherwise by generating unlimited opportunities.
- Band membership should be observed rather than assigned. Where an inner-band
  placement is contradicted by a year of interaction data, that contradiction
  is itself worth surfacing to the user.

## What this implies for scoring

Applied throughout.

1. Every score must decompose. A relationship strength that cannot be
   explained as its contributing parts cannot be argued with, and an
   unarguable score in a personal tool will simply be distrusted.
2. Compare a relationship to its own baseline, not to a global one. Cadence,
   reciprocity and breadth are only meaningful relative to the history of that
   particular pair.
3. Absence of evidence is not evidence. A gap in the record more often means
   the channel is not imported than that the relationship has decayed. Where a
   score is computed over partial sources, that partiality should be visible.
4. Structural conclusions and personal conclusions have different standards.
   "You are the only link between these two groups" is computable from the
   graph. "This person is looking for work" requires a source.

## Deliberately excluded

- Population priors used to fill individual gaps.
- Attribute inference from neighbours, however statistically sound.
- Any score presented as a single opaque number.
- Aggregate simulation of how the network would behave under a hypothetical.

## Open questions

- How to weight the components of tie strength, and whether the weights should
  differ per band or be learned from the user's own confirmations.
- Whether reflection, in the Park sense, should run automatically over
  interactions or only on explicit user request. Automatic synthesis produces
  useful summaries and also produces confident errors.
- How to represent a relationship that is dormant by agreement rather than by
  neglect, which currently looks identical in the data.
- Whether brokerage should be surfaced to the user at all, given that framing
  a friendship as a strategic asset is a tonal risk for a personal tool.
