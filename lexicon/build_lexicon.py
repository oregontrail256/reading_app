#!/usr/bin/env python3
"""Build shared/lexicon.json: frequency-ranked words with grapheme segmentation,
phonics pattern tags, and heart-word (irregular part) annotations.

Sources: CMU Pronouncing Dictionary (pronunciations), wordfreq (frequency rank).
Run:  pip install cmudict wordfreq && python3 lexicon/build_lexicon.py
"""
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import cmudict
from wordfreq import top_n_list, zipf_frequency

HERE = Path(__file__).parent
OUT = HERE.parent / "shared"
TOP_N = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

VOWEL_PHONES = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY",
                "OW", "OY", "UH", "UW", "AX", "IX"}
VOWEL_LETTERS = set("aeiou")
LONG = {"a": "EY", "e": "IY", "i": "AY", "o": "OW", "u": "UW"}


def norm_phones(pron):
    out = []
    for p in pron:
        base = re.sub(r"\d", "", p)
        stress = p[-1] if p[-1].isdigit() else ""
        if base == "AH" and stress == "0":
            base = "AX"
        elif base == "IH" and stress == "0":
            base = "IX"
        out.append(base)
    return tuple(out)


# grapheme -> list of (phones, tag, cost). Tag None means "consonants".
G = {}


def add(g, phones, tag=None, cost=1.0):
    G.setdefault(g, []).append((tuple(phones.split()) if phones else (), tag, cost))


C = None
for g, p in [("b", "B"), ("d", "D"), ("f", "F"), ("g", "G"), ("h", "HH"), ("j", "JH"),
             ("k", "K"), ("l", "L"), ("m", "M"), ("n", "N"), ("p", "P"), ("r", "R"),
             ("s", "S"), ("s", "Z"), ("t", "T"), ("v", "V"), ("w", "W"), ("y", "Y"),
             ("z", "Z"), ("c", "K")]:
    add(g, p, C)
add("n", "NG", "ng_nk")              # the n in "pink" (N G K -> NG K)
add("x", "K S", "x_qu"); add("x", "G Z", "x_qu"); add("qu", "K W", "x_qu")
for d in "bdfglmnprstvz":
    add(d + d, {"b": "B", "d": "D", "f": "F", "g": "G", "l": "L", "m": "M", "n": "N",
                "p": "P", "r": "R", "s": "S", "t": "T", "v": "V", "z": "Z"}[d],
        "floss" if d in "flsz" else C)
add("ss", "Z", "floss")
add("sh", "SH", "digraph_sh")
add("ch", "CH", "digraph_ch"); add("ch", "K", "advanced"); add("ch", "SH", "advanced")
add("th", "TH", "digraph_th"); add("th", "DH", "digraph_th")
add("wh", "W", "digraph_wh")
add("ck", "K", "digraph_ck")
add("ng", "NG", "ng_nk"); add("ng", "NG G", "ng_nk")
add("tch", "CH", "tch_dge"); add("dge", "JH", "tch_dge")
add("c", "S", "soft_cg"); add("g", "JH", "soft_cg")
add("kn", "N", "silent_letters"); add("wr", "R", "silent_letters"); add("mb", "M", "silent_letters")
add("gn", "N", "silent_letters")
add("ph", "F", "ph")
add("tion", "SH AX N", "tion_ture"); add("ture", "CH ER", "tion_ture")
add("le", "AX L", "cle")

# short vowels
add("a", "AE", "short_a"); add("e", "EH", "short_e"); add("i", "IH", "short_i")
add("i", "IX", "short_i"); add("e", "IX", "short_e")
add("o", "AA", "short_o"); add("o", "AO", "short_o"); add("u", "AH", "short_u")
add("a", "AO", "a_al")
# long single vowels (resolved later into vce / open / closed_long)
for v, p in LONG.items():
    add(v, p, "LONG_" + v, 1.1)
add("u", "Y UW", "LONG_u", 1.1)
# schwa (fine in multisyllable words)
for v in "aeiou":
    add(v, "AX", "SCHWA", 1.3)
    add(v, "IX", "SCHWA", 1.35)
add("o", "ER", "SCHWA", 1.5)
# silent e
add("e", "", "SILENT_E", 1.0)
# y as vowel
add("y", "AY", "y_long_i"); add("y", "IY", "y_long_e"); add("y", "IX", "y_long_e")
add("y", "IH", "advanced")
# r-controlled
add("ar", "AA R", "r_ar"); add("ar", "ER", "r_er"); add("ar", "AO R", "r_or")
add("or", "AO R", "r_or"); add("or", "ER", "r_er"); add("ore", "AO R", "r_or")
add("er", "ER", "r_er"); add("ir", "ER", "r_er"); add("ur", "ER", "r_er")
add("err", "EH R", "advanced")
add("air", "EH R", "r_other"); add("are", "EH R", "r_other"); add("ear", "IH R", "r_other")
add("eer", "IH R", "r_other"); add("ere", "IH R", "r_other"); add("our", "AW ER", "r_other")
add("ear", "ER", "r_other"); add("our", "AO R", "r_other")
# vowel teams
add("ai", "EY", "vt_ai_ay"); add("ay", "EY", "vt_ai_ay")
add("ee", "IY", "vt_ee_ea"); add("ea", "IY", "vt_ee_ea"); add("ea", "EH", "vt_other")
add("oa", "OW", "vt_oa_ow"); add("ow", "OW", "vt_oa_ow"); add("oe", "OW", "vt_oa_ow")
add("igh", "AY", "vt_igh_ie"); add("ie", "AY", "vt_igh_ie"); add("ie", "IY", "vt_other")
add("oo", "UW", "oo"); add("oo", "UH", "oo")
add("ou", "AW", "diph_ou_ow"); add("ow", "AW", "diph_ou_ow")
add("oi", "OY", "diph_oi_oy"); add("oy", "OY", "diph_oi_oy")
add("au", "AO", "vt_au_aw"); add("aw", "AO", "vt_au_aw"); add("augh", "AO", "vt_au_aw")
add("ue", "UW", "vt_ue_ew"); add("ew", "UW", "vt_ue_ew"); add("ew", "Y UW", "vt_ue_ew")
add("ey", "IY", "vt_other"); add("ey", "EY", "vt_other"); add("ei", "EY", "vt_other")
add("eigh", "EY", "vt_other")
# suffix graphemes (only allowed at word end when the base word exists)
add("ed", "T", "SUFFIX_ed"); add("ed", "D", "SUFFIX_ed"); add("ed", "IX D", "SUFFIX_ed")
add("ed", "AX D", "SUFFIX_ed")
add("es", "IX Z", "SUFFIX_es"); add("es", "AX Z", "SUFFIX_es"); add("es", "Z", "SUFFIX_es")

MAXG = max(len(g) for g in G)
WILD_COST = 6.0

# Words programs teach as heart words even when the dictionary alignment looks regular-ish.
HEART_OVERRIDES = {
    "a", "i", "the", "of", "to", "do", "you", "your", "said", "says", "are", "was", "were",
    "what", "one", "once", "two", "have", "give", "live", "come", "some", "done", "gone",
    "does", "there", "where", "their", "they", "could", "would", "should", "who", "any",
    "many", "again", "been", "both", "from", "love", "other", "put", "pull", "push", "full",
    "want", "water", "work", "word", "world", "eye", "friend", "school", "people", "because",
    "only", "mother", "brother", "buy", "four", "laugh", "here", "very", "into", "onto",
    "today", "together", "look", "good", "he", "she", "we", "me", "be", "no", "go", "so",
}

with open(HERE / "blocklist.txt") as f:
    BLOCK = {w.strip() for w in f if w.strip() and not w.startswith("#")}

CMU = cmudict.dict()


KID = set()  # children's-book vocabulary (kid_words.txt)
CORE = set()  # filled in main(): words eligible as morphological bases


def base_exists(word, suffix):
    """Is `word` = base + suffix (with common spelling changes) for a real base word?"""
    if not word.endswith(suffix) or len(word) <= len(suffix) + 2:
        return None
    stem = word[: -len(suffix)]
    cands = [stem, stem + "e"]
    if len(stem) >= 2 and stem[-1] == stem[-2]:
        cands.append(stem[:-1])
    if stem.endswith("i"):
        cands.append(stem[:-1] + "y")
    for c in cands:
        if c in CORE and len(c) >= 3:
            return c
    return None


def align(word, phones, allow_suffix):
    """Min-cost segmentation of letters into graphemes mapped to phone slices."""
    n, m = len(word), len(phones)

    @lru_cache(maxsize=None)
    def best(i, j):
        if i == n and j == m:
            return (0.0, ())
        if i == n:
            return (float("inf"), ())
        out = (float("inf"), ())
        for L in range(min(MAXG, n - i), 0, -1):
            g = word[i:i + L]
            for ph, tag, cost in G.get(g, ()):
                if tag and tag.startswith("SUFFIX"):
                    if i + L != n or not allow_suffix.get(tag):
                        continue
                k = len(ph)
                if phones[j:j + k] != ph:
                    continue
                sub = best(i + L, j + k)
                c = cost + sub[0]
                if c < out[0]:
                    out = (c, ((g, ph, tag),) + sub[1])
        # wildcard: one letter -> 0..2 phones (irregular)
        for k in (1, 0, 2):
            if j + k <= m:
                sub = best(i + 1, j + k)
                c = WILD_COST + sub[0]
                if c < out[0]:
                    out = (c, ((word[i], phones[j:j + k], "IRREGULAR"),) + sub[1])
        return out

    return best(0, 0)


def is_cons_phone(p):
    return p not in VOWEL_PHONES


def analyze(word, pron):
    phones = norm_phones(pron)
    suffix_base = {}
    allow = {}
    for suf, tag in (("ed", "SUFFIX_ed"), ("es", "SUFFIX_es")):
        b = base_exists(word, suf)
        if b:
            allow[tag] = True
            suffix_base[suf] = b
    cost, segs = align(word, phones, allow)
    segs = list(segs)
    if not segs:
        return None

    patterns = set()
    irregular_spans = []
    pos = 0
    spans = []
    for g, ph, tag in segs:
        spans.append((pos, pos + len(g)))
        pos += len(g)

    vowel_idx = [k for k, (g, ph, t) in enumerate(segs) if any(p in VOWEL_PHONES for p in ph)]
    n_vowel_phones = sum(1 for p in phones if p in VOWEL_PHONES)

    # morphology
    morph = None
    for suf, pat in (("ing", "suffix_ing"), ("ed", "suffix_ed"), ("es", "suffix_s"), ("s", "suffix_s")):
        b = base_exists(word, suf)
        if b and b != word:
            morph = (suf, pat, b)
            break
    suffix_letters = len(morph[0]) if morph else 0
    base_end = len(word) - suffix_letters

    for k, (g, ph, tag) in enumerate(segs):
        s0, s1 = spans[k]
        if tag is None:
            patterns.add("consonants")
        elif tag == "IRREGULAR":
            irregular_spans.append((s0, s1))
        elif tag.startswith("SUFFIX"):
            patterns.add("suffix_ed" if tag == "SUFFIX_ed" else "suffix_s")
        elif tag == "SCHWA":
            if n_vowel_phones <= 1:
                irregular_spans.append((s0, s1))
            else:
                patterns.add("two_syllable")
        elif tag.startswith("LONG_"):
            v = tag[-1]
            nxt = segs[k + 1:]
            # VCe: long vowel, one consonant grapheme, then silent e (or -ed/-es/-er/-ing after dropped e)
            if (len(nxt) >= 2 and nxt[0][1] and all(is_cons_phone(p) for p in nxt[0][1])
                    and len(nxt[0][0]) <= 2
                    and (nxt[1][2] in ("SILENT_E", "SUFFIX_ed", "SUFFIX_es")
                         or (nxt[1][0] == "e" and k + 2 < len(segs)))):
                patterns.add("vce_" + v)
            elif (len(nxt) >= 1 and nxt[0][1] and all(is_cons_phone(p) for p in nxt[0][1])
                  and len(nxt) >= 2 and nxt[1][0] in ("ing", "i") and morph and morph[0] == "ing"):
                patterns.add("vce_" + v)  # making (make + ing)
            elif not nxt or any(p in VOWEL_PHONES for p in nxt[0][1]) or (
                    len(nxt) >= 2 and len(nxt[0][1]) == 1 and any(p in VOWEL_PHONES for p in nxt[1][1])):
                patterns.add("open_vowel")
            else:
                patterns.add("closed_long")
        elif tag == "SILENT_E":
            prev = segs[k - 1] if k >= 1 else None
            prev2 = segs[k - 2] if k >= 2 else None
            if prev2 and prev2[2] and prev2[2].startswith("LONG_"):
                pass  # part of VCe
            elif prev and prev[2] in ("soft_cg",) :
                pass
            elif prev and prev[2] in ("tch_dge", "r_or", "r_other", "vt_ue_ew", "vt_oa_ow"):
                pass
            elif k == len(segs) - 1 or (morph and s1 >= base_end):
                patterns.add("advanced")
            else:
                patterns.add("advanced")
        else:
            patterns.add(tag)

    # blends: >=2 consonant graphemes before the first / after the last vowel (base only)
    if vowel_idx:
        base_vowels = [k for k in vowel_idx if spans[k][0] < base_end] or vowel_idx
        first, last = base_vowels[0], base_vowels[-1]
        onset = [s for s in segs[:first]]
        if len(onset) >= 2 and all(s[1] and all(is_cons_phone(p) for p in s[1]) for s in onset):
            patterns.add("blend_initial")
        coda = [s for kk, s in enumerate(segs[last + 1:], start=last + 1) if spans[kk][0] < base_end]
        coda = [s for s in coda if s[2] != "SILENT_E"]
        if len(coda) >= 2 and all(s[1] and all(is_cons_phone(p) for p in s[1]) for s in coda):
            if not (len(coda) == 2 and coda[0][2] == "ng_nk" and coda[1][0] == "k"):
                patterns.add("blend_final")
        if any(s[2] == "ng_nk" for s in segs):
            patterns.add("ng_nk")

    if morph:
        patterns.add(morph[1])
    # syllables in the base word
    suffix_syll = 1 if morph and morph[0] in ("ing",) else 0
    if morph and morph[0] in ("ed", "es") and len([p for p in phones[-2:] if p in VOWEL_PHONES]):
        suffix_syll = 1
    base_syll = n_vowel_phones - suffix_syll
    if base_syll >= 3:
        patterns.add("multisyllable")
    elif base_syll == 2:
        patterns.add("two_syllable")
    if "'" in word:
        patterns.add("contraction")

    heart = bool(irregular_spans) or word in HEART_OVERRIDES
    hp = None
    if irregular_spans:
        hp = [min(s for s, _ in irregular_spans), max(e for _, e in irregular_spans)]
    elif heart:
        # mark the vowel grapheme(s) as the part to learn by heart
        vs = [spans[k] for k in vowel_idx] or [(0, len(word))]
        hp = [vs[0][0], vs[-1][1]]

    seg_out = [[g, " ".join(ph), (tag or "consonants")] for g, ph, tag in segs]
    return {
        "seg": seg_out,
        "p": sorted(patterns),
        "h": heart,
        "hp": hp,
        "syl": n_vowel_phones,
        "base": morph[2] if morph else None,
        "_cost": cost + (20 if irregular_spans else 0),
    }


def main():
    words = []
    seen = set()
    for w in top_n_list("en", TOP_N * 3):
        if len(words) >= TOP_N:
            break
        if not re.fullmatch(r"[a-z]+('[a-z]+)?", w) or w in BLOCK or w in seen:
            continue
        if w not in CMU:
            continue
        if len(w) == 1 and w not in ("a", "i"):
            continue
        seen.add(w)
        words.append(w)

    kid_text = "\n".join(l for l in open(HERE / "kid_words.txt") if not l.startswith("#"))
    KID.update(kid_text.split())
    for w in kid_text.split():
        if not re.fullmatch(r"[a-z]+", w):
            continue
        if w in CMU and w not in seen and w not in BLOCK:
            seen.add(w)
            words.append(w)
    words.sort(key=lambda x: -zipf_frequency(x, "en"))
    CORE.update(words)

    # add inflections of the top 3000 words so generated text like "jumped" resolves
    extra = []
    for w in words[:4000]:
        for suf in ("s", "es", "ed", "ing", "er", "est", "y", "ly"):
            for cand in (w + suf, w + w[-1] + suf, (w[:-1] + suf) if w.endswith("e") else None,
                         (w[:-1] + "i" + suf) if w.endswith("y") and suf in ("es", "ed", "er", "est") else None):
                if cand and cand not in seen and cand in CMU and cand not in BLOCK:
                    seen.add(cand)
                    extra.append(cand)

    out = {}
    rank = 0
    for w in words + sorted(extra, key=lambda x: -zipf_frequency(x, "en")):
        cands = [a for a in (analyze(w, pr) for pr in CMU[w][:3]) if a]
        if not cands:
            continue
        info = min(cands, key=lambda a: a["_cost"])
        del info["_cost"]
        rank += 1
        info["r"] = rank
        info["z"] = round(zipf_frequency(w, "en"), 2)
        if w in KID:
            info["k"] = 1
        out[w] = info

    OUT.mkdir(exist_ok=True)
    with open(OUT / "lexicon.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    patterns = json.load(open(HERE / "patterns.json"))
    for i, p in enumerate(patterns):
        p["order"] = i + 1
    with open(OUT / "patterns.json", "w") as f:
        json.dump(patterns, f, indent=1)
    print(f"wrote {len(out)} words ({len(words)} core + {len(extra)} inflections)")


if __name__ == "__main__":
    main()
