import ipaddress


class HttpMetaData:
    def __init__(self, request=None):
        self.request = request

    def get_ip(self):
        def normalize_ip_internal(ip_str: str) -> str:
            try:
                addr = ipaddress.ip_address(ip_str)
                if addr.version == 6 and addr.ipv4_mapped:
                    return str(addr.ipv4_mapped)
                return str(addr)
            except ValueError:
                return ip_str

        x_forwarded_for = self.request.META.get("HTTP_X_FORWARDED_FOR")

        if x_forwarded_for:
            ip_str = x_forwarded_for.split(",")[0].strip()
        else:
            ip_str = self.request.META.get("REMOTE_ADDR")

        if ip_str:
            return normalize_ip_internal(ip_str)

        return None

    def get_user_agent(self):
        possible_headers = [
            "HTTP_USER_AGENT",
            "User-Agent",
            "HTTP_SEC_CH_UA",
            "HTTP_SEC_CH_UA_MOBILE",
            "HTTP_SEC_CH_UA_PLATFORM",
        ]

        for header in possible_headers:
            ua = self.request.headers.get(header) or self.request.META.get(header)
            if ua:
                return ua

        return "Unknown"
