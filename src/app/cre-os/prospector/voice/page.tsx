/**
 * /cre-os/prospector/voice
 *
 * Edit the global broker voice profile. This gets injected into every
 * AI draft regardless of which persona is active.
 */

import { loadBrokerVoice } from "@/lib/cre-os/personas-queries";
import { BrokerVoiceEditView } from "@/components/cre-os/prospector/BrokerVoiceEditView";

export const dynamic = "force-dynamic";

export default async function BrokerVoicePage() {
  const voice = await loadBrokerVoice();
  return <BrokerVoiceEditView voice={voice} />;
}
