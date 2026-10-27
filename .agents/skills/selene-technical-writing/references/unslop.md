# Unslop checklist

Scan the text you touched for each pattern and rewrite what matches. Keep the meaning and the tone. Never apply it inside a verbatim quote.

## Content

1. **Empty -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...". Delete them or state the fact.
2. **Vague attributions.** "Best practice says", "Experts recommend". Name the source (a doc, a skill, a decision in `## Log`) or delete.
3. **Generic conclusions.** "This makes the system more robust." State the specific effect or cut it.
4. **Sentences that fit any project.** If a sentence could appear unchanged in another repository's docs, it says nothing about Selene. Cut it or make it specific.

## Language

5. **AI vocabulary.** additionally, crucial, delve, enhance, foster, garner, interplay, intricate, landscape, pivotal, robust, seamless, showcase, testament, underscore, vibrant. Use plain words.
6. **Fancy "is".** "serves as", "stands as", "boasts", "features". Write "is" or "has".
7. **"Not just X, but Y".** State the point directly.
8. **Forced groups of three.** Use the natural number of items.
9. **Synonym cycling.** One name per thing (see the Hard Rules on real names).
10. **Plain words.** utilize and leverage become use, facilitate becomes help, numerous becomes many, in the event that becomes if, in order to becomes to, due to the fact that becomes because.
11. **Abstract metaphor nouns.** substrate, vector, locus, nexus, paradigm, north star, flywheel, harness as a metaphor, surface as in "API surface", ratchet as a metaphor. Use the concrete word or the mechanism's real name.
12. **Mannered prose.** Aphorisms, personified code ("the plan holds it"), figurative verbs ("rides along"). Say what happens.

## Style

13. **Em dashes.** None. End the sentence or use a comma.
14. **Mid-sentence colons.** Use a colon only before a list or an example.
15. **Bold overuse.** Bold UI labels and the lead-in of a list item, not every term.
16. **Inline-header lists.** "**Performance:** Performance improved..." restates itself. Write the line as prose. A bold lead-in followed by new detail is fine.
17. **Title Case headings.** Use sentence case.
18. **Decorative emojis and curly quotes.** Remove emojis. Use straight quotes.

## Filler and tone

19. **Hedging.** "could potentially possibly" becomes "may". A fact needs no hedge.
20. **Adverbs propping a weak verb.** "runs quickly" becomes the number or a stronger verb.
21. **Passive voice.** Name the actor unless it is unknown or irrelevant.
22. **Chatbot and sycophantic phrases.** "I hope this helps", "Great question", "Certainly". Remove.
23. **Pre-announcements.** "We will soon support...". Document what exists.
24. **"Simply", "easy", "just", "quickly" in steps.** Remove. If it were easy, the reader would not need the doc.

## Density

25. **Dense sentences.** If the reader has to reread a sentence, split it or drop clauses.
26. **Over-compression.** Dropped articles, verbless fragments, arrows, and private abbreviations. "Parser rejects bad date → exit 2, no write" becomes "The parser rejects a bad date, exits with code 2, and writes nothing." Tables and task lines in `odd/tasks` may stay terse; prose may not.
