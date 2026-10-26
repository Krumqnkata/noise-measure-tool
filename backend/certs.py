"""Самоподписан сертификат за --https. Телефоните дават достъп до микрофона само по
https, а в локалната мрежа няма истински сертификат – затова правим свой.
Браузърът ще предупреди веднъж („връзката не е поверителна“) – това е очаквано."""

import datetime
import ipaddress
import socket
from pathlib import Path


def local_addresses() -> list[str]:
    """IP адресите на компютъра в локалната мрежа (за адреса, който се отваря от телефона)."""
    addresses = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass
    # Адресът, през който излиза трафикът навън – най-често този от Wi-Fi мрежата
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))   # не се изпраща нищо, само избира интерфейс
            addresses.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(a for a in addresses if not a.startswith("127."))


def ensure_certificate(folder: Path) -> tuple[Path, Path]:
    cert_path, key_path = folder / "cert.pem", folder / "key.pem"
    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    folder.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Shumomer (local)")])
    alt_names = [x509.DNSName("localhost"), x509.DNSName(socket.gethostname()),
                 x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    alt_names += [x509.IPAddress(ipaddress.ip_address(a)) for a in local_addresses()]
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path
