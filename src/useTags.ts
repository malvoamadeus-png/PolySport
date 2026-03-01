import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export type TagValue = "顶尖" | "高手" | "排除";

export function useTags() {
  const [tags, setTags] = useState<Record<string, TagValue>>({});

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("address_tags")
      .select("address,tag")
      .then(({ data }) => {
        if (!data) return;
        const m: Record<string, TagValue> = {};
        for (const row of data) m[row.address] = row.tag as TagValue;
        setTags(m);
      });
  }, []);

  const setTag = useCallback(async (address: string, tag: TagValue | null, email: string) => {
    if (!supabase) return;
    if (tag === null) {
      setTags((prev) => {
        const next = { ...prev };
        delete next[address];
        return next;
      });
      await supabase.from("address_tags").delete().eq("address", address);
    } else {
      setTags((prev) => ({ ...prev, [address]: tag }));
      await supabase.from("address_tags").upsert(
        { address, tag, updated_by: email, updated_at: new Date().toISOString() },
        { onConflict: "address" }
      );
    }
  }, []);

  return { tags, setTag };
}
