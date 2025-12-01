import dns from "node:dns";

// Force IPv4 first to avoid ENETUNREACH errors in VPCs without IPv6 routes.
dns.setDefaultResultOrder("ipv4first");
