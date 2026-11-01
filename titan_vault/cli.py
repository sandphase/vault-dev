from typer import Typer
import typer
import requests
import uvicorn
from rich.console import Console

app = Typer()
console = Console()
API_URL = "http://127.0.0.1:8200"

@app.command()
def server(port: int = 8200, host: str = "0.0.0.0"):
    """Inicia el servidor API de Titan Vault."""
    console.print(f"[bold green]🚀 Iniciando Titan Vault en {host}:{port}...[/bold green]")
    uvicorn.run("titan_vault.api:app", host=host, port=port)

@app.command()
def unseal(password: str = typer.Option(..., prompt=True, hide_input=True)):
    """Desbloquea la bóveda."""
    res = requests.post(f"{API_URL}/sys/unseal", json={"master_password": password})
    if res.status_code == 200:
        console.print("[bold green]✅ Bóveda desbloqueada con éxito.[/bold green]")
    else:
        console.print(f"[bold red]❌ Error: {res.text}[/bold red]")

@app.command()
def init_token(name: str):
    """Crea un token maestro saltando la API (Solo usar la primera vez por un Admin del Servidor)."""
    from titan_vault.core import VaultCore
    vault = VaultCore.get_instance()
    token = vault.create_token(name, {"*": "admin"})
    console.print(f"[bold yellow]🔑 Token Maestro creado:[/bold yellow] {token}")

@app.command()
def init_wrap_token(name: str, path: str):
    """Crea un Token de un solo uso (Burn-on-Read) para una ruta específica."""
    from titan_vault.core import VaultCore
    vault = VaultCore.get_instance()
    token = vault.create_token(name, {path: "read", "_one_time": True})
    console.print(f"[bold red]🔥 Token Wrap (1-uso) creado:[/bold red] {token}")

@app.command()
def read(path: str, token: str = typer.Option(..., envvar="VAULT_TOKEN"), version: int = None):
    """Lee un secreto de la bóveda."""
    url = f"{API_URL}/secret/data/{path}"
    if version:
        url += f"?version={version}"
    res = requests.get(url, headers={"X-Vault-Token": token})
    if res.status_code == 200:
        val = res.json()["data"]["value"]
        console.print(f"[bold cyan]Secreto ({path}):[/bold cyan] {val}")
    else:
        console.print(f"[bold red]❌ Denegado/No Encontrado: {res.json().get('detail', res.text)}[/bold red]")

@app.command()
def write(path: str, value: str, token: str = typer.Option(..., envvar="VAULT_TOKEN")):
    """Escribe un secreto en la bóveda."""
    res = requests.post(f"{API_URL}/secret/data/{path}", json={"value": value}, headers={"X-Vault-Token": token})
    if res.status_code == 200:
        console.print(f"[bold green]✅ Secreto escrito exitosamente en '{path}'[/bold green]")
    else:
        console.print(f"[bold red]❌ Error: {res.json().get('detail', res.text)}[/bold red]")

if __name__ == "__main__":
    app()
