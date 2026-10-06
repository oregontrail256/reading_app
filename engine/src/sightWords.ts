/**
 * Dolch pre-primer and primer sight words. A mid-1st-grade reader knows these on sight even when
 * their spelling uses patterns he hasn't learned (for, out, down, my, see, play), so they count as
 * known unless his own record says he is still learning one.
 */
export const SIGHT_WORDS = new Set(
  (
    // pre-primer
    "a and away big blue can come down find for funny go help here i in is it jump little look make me my not one play red run said see the three to two up we where yellow you " +
    // primer
    "all am are at ate be black brown but came did do eat four get good have he into like must new no now on our out please pretty ran ride saw say she so soon that there they this too under want was well went what white who will with yes"
  ).split(" "),
);
