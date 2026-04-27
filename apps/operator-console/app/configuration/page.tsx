import { redirect } from "next/navigation";

import { configResourceKeys } from "@/lib/configuration/schemas";

export default function ConfigurationIndexPage() {
  redirect(`/configuration/${configResourceKeys[0]}`);
}
