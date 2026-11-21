#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Ledger as _, Env, String};

const DETERMINISTIC_LEDGER_SEQUENCE: u32 = 1;
const DETERMINISTIC_LEDGER_TIMESTAMP: u64 = 1_700_000_000;

fn deterministic_env() -> Env {
    let env = Env::default();
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = DETERMINISTIC_LEDGER_SEQUENCE;
        ledger.timestamp = DETERMINISTIC_LEDGER_TIMESTAMP;
    });
    env
}

#[test]
fn returns_the_supplied_greeting_target() {
    let env = deterministic_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let name = String::from_str(&env, "StellarForge");

    assert_eq!(
        client.hello(&name),
        name,
        "expected hello() to return the supplied greeting target in the local test environment",
    );
}

#[test]
fn handles_empty_greeting_target_deterministically() {
    let env = deterministic_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let empty = String::from_str(&env, "");

    assert_eq!(
        client.hello(&empty),
        empty,
        "expected hello() to return an empty string unchanged",
    );
}

#[test]
fn greeting_is_independent_of_ledger_time_and_sequence() {
    let env = deterministic_env();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);
    let name = String::from_str(&env, "StellarForge");

    let initial_result = client.hello(&name);

    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = DETERMINISTIC_LEDGER_SEQUENCE + 100;
        ledger.timestamp = DETERMINISTIC_LEDGER_TIMESTAMP + 86_400;
    });

    let later_result = client.hello(&name);

    assert_eq!(
        later_result, initial_result,
        "expected hello() output to remain deterministic across explicit ledger sequence and timestamp changes",
    );
}
