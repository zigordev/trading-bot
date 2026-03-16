use std::collections::HashSet;

use anyhow::{Context, Result, bail};
use rdkafka::{
    ClientConfig,
    admin::{AdminClient, AdminOptions, NewTopic, TopicReplication},
    client::DefaultClientContext,
    error::RDKafkaErrorCode,
};

pub async fn ensure_topics(bootstrap_servers: &str, topics: &[&str]) -> Result<()> {
    let admin = ClientConfig::new()
        .set("bootstrap.servers", bootstrap_servers)
        .create::<AdminClient<DefaultClientContext>>()
        .context("failed to create Kafka admin client")?;

    let mut seen = HashSet::new();
    let topic_names = topics
        .iter()
        .copied()
        .filter(|topic| !topic.trim().is_empty())
        .filter(|topic| seen.insert(*topic))
        .collect::<Vec<_>>();
    if topic_names.is_empty() {
        return Ok(());
    }

    let new_topics = topic_names
        .iter()
        .map(|topic| NewTopic::new(topic, 1, TopicReplication::Fixed(1)))
        .collect::<Vec<_>>();

    let results = admin
        .create_topics(&new_topics, &AdminOptions::new())
        .await
        .context("failed to ensure Kafka topics")?;

    for result in results {
        match result {
            Ok(_) => {}
            Err((_, RDKafkaErrorCode::TopicAlreadyExists)) => {}
            Err((topic, error_code)) => {
                bail!("failed to ensure Kafka topic {topic}: {error_code:?}");
            }
        }
    }

    Ok(())
}
