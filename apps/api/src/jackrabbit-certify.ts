import "dotenv/config";
import { jackrabbitProviderFromEnv } from "./jackrabbit-provider.js";

const provider = jackrabbitProviderFromEnv();
const organization = await provider.verifyConnection();
const options = await provider.findClassOptions({
  name: process.env.FRONTDESKWISE_JACKRABBIT_CLASS_NAME ?? "Turtle 2",
  location: process.env.FRONTDESKWISE_JACKRABBIT_LOCATION ?? "Largo",
});
const registrationBaseUrl = process.env.FRONTDESKWISE_JACKRABBIT_REGISTRATION_BASE_URL;
const registrationClassIdParam = process.env.FRONTDESKWISE_JACKRABBIT_CLASS_ID_PARAM ?? "classId";

console.log(JSON.stringify({
  organization: { id: organization.id, name: organization.name },
  search: {
    className: process.env.FRONTDESKWISE_JACKRABBIT_CLASS_NAME ?? "Turtle 2",
    location: process.env.FRONTDESKWISE_JACKRABBIT_LOCATION ?? "Largo",
  },
  options: options.map((option) => ({
    id: option.id,
    name: option.name,
    location: option.location,
    days: option.days,
    startTime: option.startTime,
    endTime: option.endTime,
    openings: option.openings,
    waitlistCount: option.waitlistCount,
    waitlistAvailable: option.waitlistAvailable,
    tuition: option.tuition,
    registrationUrl: option.registrationUrl,
    ...(registrationBaseUrl
      ? {
        prefilledRegistrationLink: provider.buildRegistrationLink(
          { baseUrl: registrationBaseUrl, classIdParam: registrationClassIdParam, fieldMappings: {} },
          option,
        ).url,
      }
      : {}),
    source: option.source,
  })),
}, null, 2));

if (!options.length) {
  console.error("No matching Jackrabbit class options were found");
  process.exitCode = 1;
}
